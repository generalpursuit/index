import { apiURL } from "./urls";
import { test, expect, type Locator, type Page } from "@playwright/test";

let data: { privateLink: { id: string }; conversationShortId: string };
async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email or username", { exact: true }).fill("alice@test.example");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
}
const openEditor = async (page: Page) => {
  await page
    .locator('.week-page[data-active="true"] .own-links')
    .getByRole("button", { name: "Are.na", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Post", exact: true })
    .getByRole("link", { name: "Edit", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Edit link", exact: true });
};
test.beforeEach(async ({ request }) => {
  data = await (await request.post(apiURL + "/_test/reset")).json();
});

test("⌘, opens Settings while signed in, as the Settings link is shown", async ({ page }) => {
  // Signed out there is no Settings to open, so the shortcut leaves the page alone.
  await page.goto("/u/alice");
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Comma");
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/u\/alice$/);
  await login(page);
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveAttribute(
    "aria-keyshortcuts",
    process.platform === "darwin" ? "Meta+," : "Control+,",
  );
  await page.keyboard.press("ControlOrMeta+Comma");
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("button", { name: "Edit profile", exact: true })).toBeVisible();
});

test("Escape leaves one layer at a time; a note breaks lines on Return and saves on ⌘↩", async ({
  page,
}) => {
  await login(page);
  const post = page.getByRole("dialog", { name: "Post", exact: true });
  const editor = await openEditor(page);
  // A menu over the editor closes before the editor, and the editor before its post.
  await editor.getByRole("button", { name: /^Group:/ }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(editor).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(post).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await openEditor(page);
  const note = editor.getByLabel("Note", { exact: true });
  await note.fill("First line");
  await note.press("Enter");
  await note.pressSequentially("Second line");
  await expect(note).toHaveValue("First line\nSecond line");
  await expect(editor).toBeVisible();
  await note.press("ControlOrMeta+Enter");
  await expect(editor).toHaveCount(0);
  await expect(post).toBeVisible();
  await post.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(note).toHaveValue("First line\nSecond line");
  // A single-line field saves on Return.
  await editor.getByLabel("Link", { exact: true }).press("Enter");
  await expect(editor).toHaveCount(0);
});

test("a destructive question ignores a stray Return and answers ⌘↩", async ({ page }) => {
  await login(page);
  const editor = await openEditor(page);
  const deleteLink = editor.getByRole("button", { name: "Delete link", exact: true });
  await deleteLink.click();
  const cancel = editor.getByRole("button", { name: "Cancel", exact: true });
  await expect(cancel).toBeFocused();
  // Return presses the focused Cancel.
  await page.keyboard.press("Enter");
  await expect(editor.getByRole("alert")).toHaveCount(0);
  await expect(deleteLink).toBeFocused();
  await deleteLink.click();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page
      .locator('.week-page[data-active="true"] .own-links')
      .getByRole("button", { name: "Are.na", exact: true }),
  ).toHaveCount(0);
});

test("a page's question ignores a stray Return unless its action can be undone", async ({
  page,
}) => {
  await login(page);
  await page.goto("/settings");
  const visibility = page.getByRole("button", { name: /^Profile visibility/ });
  const ask = page.getByRole("alertdialog", { name: "Make profile public?" });
  const choose = async (name: "Public" | "Private") => {
    await visibility.click();
    await page.getByRole("menuitemradio", { name, exact: true }).click();
    // Keys reach the question once it has focus, rather than the menu it was chosen in.
    await expect(page.getByRole("alertdialog").locator("button:focus")).toBeVisible();
  };
  // The menu stays open under the question; Escape closes it once the question is answered.
  const answered = async (question: Locator) => {
    await expect(question).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
  };
  // Going public accepts pending follow requests for good, so Return presses Cancel.
  const cancel = ask.getByRole("button", { name: "Cancel", exact: true });
  await choose("Public");
  await expect(cancel).toBeFocused();
  // Escape cancels the question, then closes the menu it was chosen in.
  await page.keyboard.press("Escape");
  await expect(ask).toHaveCount(0);
  await expect(page.getByRole("menu")).toBeVisible();
  await answered(ask);
  await choose("Public");
  await page.keyboard.press("Enter");
  await answered(ask);
  await expect(visibility).toContainText("Private");
  await choose("Public");
  await page.keyboard.press("ControlOrMeta+Enter");
  await answered(ask);
  await expect(visibility).toContainText("Public");
  // Going private again can be undone, so Return confirms it.
  const back = page.getByRole("alertdialog", { name: "Make profile private?" });
  await choose("Private");
  await expect(back.getByRole("button", { name: "Make private", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await answered(back);
  await expect(visibility).toContainText("Private");
});

test("⌘, waits for an open modal, its input and its pending action", async ({ page }) => {
  await login(page);
  await page.goto("/u/alice");
  await page
    .getByRole("navigation", { name: "Lists" })
    .getByRole("button", { name: "New group", exact: true })
    .click();
  const form = page.getByRole("dialog", { name: "New group", exact: true });
  const name = form.getByLabel("Name", { exact: true });
  await name.fill("Half typed");
  await page.keyboard.press("ControlOrMeta+Comma");
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/u\/alice$/);
  await expect(name).toHaveValue("Half typed");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/rpc/v1/groups/create", async (route) => {
    await held;
    await route.abort("failed");
  });
  await form.getByRole("button", { name: "Create", exact: true }).click();
  await expect(form.getByRole("button", { name: "Creating…", exact: true })).toBeDisabled();
  await page.keyboard.press("ControlOrMeta+Comma");
  release();
  await expect(form.getByRole("button", { name: "Create", exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/\/u\/alice$/);
  await expect(name).toHaveValue("Half typed");
  // Once the modal is closed, the shortcut opens Settings again.
  await page.keyboard.press("Escape");
  await expect(form).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Comma");
  await expect(page).toHaveURL(/\/settings$/);
});

test("⌘↩ submits a modal's form from its Close button", async ({ page }) => {
  await login(page);
  const editor = await openEditor(page);
  const note = editor.getByLabel("Note", { exact: true });
  await note.fill("Saved from Close");
  await editor.getByRole("button", { name: "Close", exact: true }).focus();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(editor).toHaveCount(0);
  await page
    .getByRole("dialog", { name: "Post", exact: true })
    .getByRole("link", { name: "Edit", exact: true })
    .click();
  await expect(note).toHaveValue("Saved from Close");
});

test("⌘↩ chooses Next in the recipient picker", async ({ page }) => {
  await login(page);
  await page.goto("/links/" + data.privateLink.id);
  await page.getByRole("button", { name: "Forward", exact: true }).click();
  await page.getByRole("checkbox", { name: "Bob", exact: true }).click();
  await page.getByRole("checkbox", { name: "Lena", exact: true }).click();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page).toHaveURL(new RegExp("/messages/" + data.conversationShortId));
});

test("⌘↩ presses a recipient row that opens its chat", async ({ page }) => {
  await login(page);
  await page.goto("/messages");
  await page.getByRole("button", { name: "New message", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New message", exact: true });
  await dialog.getByRole("textbox", { name: "Search recipients" }).fill("Bob");
  // The only match opens its chat directly, and there is no Next to submit.
  const bob = dialog.getByRole("button", { name: /Bob/ });
  await expect(bob).toBeVisible();
  await bob.focus();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page).toHaveURL(/\/messages\/[^/?]+/);
  await expect(dialog).toHaveCount(0);
});

test("in the composer, Escape lets go of the message being replied to and ⌘↩ sends", async ({
  page,
}) => {
  await login(page);
  await page.goto("/messages/" + data.conversationShortId);
  const field = page.getByLabel("Message", { exact: true });
  const reply = page.locator("form.composer .draft-reply");
  const cancelReply = page.getByRole("button", { name: "Cancel reply", exact: true });
  const replyTo = async () => {
    await page
      .getByRole("listitem")
      .filter({ has: page.locator(".message-bubble", { hasText: "Adding it to my list." }) })
      .focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: "Reply", exact: true }).click();
    await expect(reply).toBeVisible();
    await expect(field).toBeFocused();
  };
  await replyTo();
  await field.press("Escape");
  await expect(reply).toHaveCount(0);
  await expect(field).toBeFocused();
  // From the composer's other controls too.
  await replyTo();
  await field.fill("Kept while letting go");
  await cancelReply.focus();
  await page.keyboard.press("Escape");
  await expect(reply).toHaveCount(0);
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("Kept while letting go");
  await replyTo();
  await field.fill("Sent from Cancel reply");
  await cancelReply.focus();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(field).toHaveValue("");
  await expect(page.locator(".message.outgoing").last().locator(".message-bubble")).toHaveText(
    "Sent from Cancel reply",
  );
});
