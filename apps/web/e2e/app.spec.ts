import { apiURL } from "./urls";
import { test, expect, type Page } from "@playwright/test";
type Fixture = {
  people: Record<string, string>;
  week: string;
  older: string;
  links: { id: string; title: string }[];
  privateLink: { id: string; title: string; url: string };
  reading: { id: string };
  notes: { id: string };
  locked: { id: string };
  conversationId: string;
  conversationShortId: string;
};
let data: Fixture;
async function login(page: Page, name = "Alice") {
  await page.goto("/login");
  await page
    .getByLabel("Email or username", { exact: true })
    .fill(name.toLowerCase() + "@test.example");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
}
test.beforeEach(async ({ request }) => {
  data = await (await request.post(apiURL + "/_test/reset")).json();
});
test("single-week layout, scrolling, adding and Favorites", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await expect(page.locator('.week-page[data-active="true"] .week-stage')).toHaveCount(1);
  await expect(page.locator('.week-page[data-active="true"] .own-links')).toContainText("Are.na");
  await expect(page.locator('.week-page[data-active="true"] .friends-carousel')).toContainText(
    "Lena",
  );
  const stage = page.locator('.week-page[data-active="true"] .week-stage'),
    carousel = page.locator('.week-page[data-active="true"] .friends-carousel');
  const rect = await carousel.boundingBox();
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(960);
  await stage.hover({ position: { x: 20, y: 20 } });
  await page.mouse.wheel(0, 650);
  // Scrolling never changes the week; the scrubber does.
  await expect(page).not.toHaveURL(/week=/);
  await page.locator(".week-tick").nth(1).click();
  await expect(page).toHaveURL(new RegExp(data.older));
  await expect(page.locator('.week-page[data-active="true"] .own-links')).toContainText(
    "Earlier notes",
  );
  await expect(page.locator('.week-page[data-active="true"] .own-links')).not.toContainText(
    "Are.na",
  );
  await page.locator(".week-tick").first().click();
  await expect(page).toHaveURL(new RegExp(data.week));
  // Links are added from the week's own field; there is no other way in.
  await expect(page.getByRole("link", { name: "Add link" })).toHaveCount(0);
  const field = page.getByRole("textbox", { name: /Enter a link to add it/ });
  await field.fill("https://pages.test/calm-software");
  await field.press("Enter");
  await expect(page.locator('.week-page[data-active="true"] .own-links')).toContainText(
    "Calm Software",
  );
  // Rows only open the post; its actions live in the detail view.
  await page
    .locator('.week-page[data-active="true"] .own-links')
    .getByRole("button", { name: "Calm Software", exact: true })
    .click();
  const post = page.getByRole("dialog", { name: "Post", exact: true });
  const favorite = post.getByRole("button", { name: "Favorite", exact: true });
  await expect(favorite).toHaveAttribute("aria-pressed", "false");
  await favorite.click();
  await expect(favorite).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(post).toHaveCount(0);
  await page.getByRole("link", { name: "Your profile", exact: true }).click();
  const favorites = page
    .getByRole("navigation", { name: "Lists" })
    .getByRole("link", { name: "Favorites", exact: true });
  await favorites.click();
  await expect(favorites).toHaveAttribute("aria-current", "page");
  // Favorites is not a destination, so its arrival removes the add row.
  await expect(page.getByRole("textbox", { name: /Enter a link/ })).toHaveCount(0);
  await expect(page.locator(".profile-links")).toContainText("Calm Software");
  await page.screenshot({
    path: "test-results/profile-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});
test("mobile navigation, private profiles, activity and privacy confirmation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await expect(page.locator('.week-page[data-active="true"] .own-links .link-row')).toHaveCount(5);
  await expect(
    page.locator('.week-page[data-active="true"] .friend-links').first().locator(".link-row"),
  ).toHaveCount(5);
  for (const panel of [
    page.locator('.week-page[data-active="true"] .own-links .link-list'),
    page.locator('.week-page[data-active="true"] .friend-links .link-list').first(),
  ]) {
    const metrics = await panel.evaluate((el) => ({
      panel: el.parentElement?.className,
      height: el.clientHeight,
      content: el.scrollHeight,
      rows: Array.from(el.children).map((row) => row.getBoundingClientRect().height),
    }));
    expect(metrics.content - metrics.height, JSON.stringify(metrics)).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: "test-results/feed-mobile.png" });
  await page.getByRole("link", { name: "Discover", exact: true }).click();
  await page.getByLabel("Search people").fill("Mia");
  await page.getByRole("link").filter({ hasText: "Mia" }).first().click();
  await expect(page.getByText("Only Mia’s followers can view their posts.")).toBeVisible();
  await expect(page.getByText("— links")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Request", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Request", exact: true }).click();
  await expect(page.getByRole("button", { name: "Requested", exact: true })).toBeVisible();
  // Profiles have no back button; the browser's back (or an edge swipe) returns.
  await page.goBack();
  await expect(page).toHaveURL(/discover/);
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(
    page.getByRole("navigation").getByRole("link", { name: "Messages", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Stars", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Requests", exact: true }).click();
  const row = page.locator(".activity-row").filter({ hasText: "mia" });
  await expect(row.getByRole("button", { name: "Accept", exact: true })).toBeVisible();
  const body = await row.locator(".activity-body").boundingBox(),
    accept = await row.getByRole("button", { name: "Accept", exact: true }).boundingBox();
  expect(Math.abs(body!.y - accept!.y)).toBeLessThan(30);
  await row.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(row).toContainText("Follow request accepted.");
  await page.getByRole("link", { name: "Your profile", exact: true }).click();
  await expect(page.getByRole("img", { name: "Private profile", exact: true })).toBeVisible();
  // Visibility lives in Settings, behind a confirmation. On phones Settings is a page as well,
  // with Back to the profile.
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole("button", { name: /^Profile visibility/ }).click();
  await page.getByRole("menuitemradio", { name: "Public", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "Make profile public?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Profile visibility/ })).toContainText("Private");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("img", { name: "Private profile", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /followers?$/ }).click();
  await expect(page.getByRole("dialog")).toContainText("mia");
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
});
test("forward to multiple recipients, restricted card and member reply", async ({
  page,
  browser,
}) => {
  await login(page);
  await page.goto("/links/" + data.privateLink.id);
  await page.getByRole("button", { name: "Forward", exact: true }).click();
  await page.getByRole("checkbox", { name: "Bob", exact: true }).click();
  await page.getByRole("checkbox", { name: "Lena", exact: true }).click();
  await page.getByRole("button", { name: "Next (2)", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("/messages/" + data.conversationShortId));
  await expect(page.getByLabel("Message", { exact: true })).toBeFocused();
  await expect(page.locator(".draft-attachment")).toContainText(data.privateLink.title);
  await expect(page.locator(".chat-scroller")).not.toContainText(data.privateLink.title);
  await page.getByLabel("Message", { exact: true }).fill("Worth reading");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator(".message-bubble").last()).toContainText("Worth reading");
  const bob = await browser.newContext();
  const recipient = await bob.newPage();
  await login(recipient, "Bob");
  await recipient.goto("/messages/" + data.conversationId);
  await expect(recipient.locator(".restricted")).toContainText("Private post from @iris");
  await expect(recipient.locator(".chat-scroller")).not.toContainText(data.privateLink.title);
  await expect(recipient.locator(".chat-scroller")).not.toContainText(data.privateLink.url);
  await recipient.getByLabel("Message", { exact: true }).fill("Thanks!");
  await recipient.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(recipient.locator(".message-bubble").last()).toContainText("Thanks!");
  await recipient.getByRole("link").filter({ hasText: "View profile" }).click();
  await expect(recipient.getByRole("button", { name: "Request", exact: true })).toBeVisible();
  await bob.close();
});
test("comments respond/delete, locked forwarding, and logout clears private data", async ({
  page,
}) => {
  await login(page);
  await page.goto("/links/" + data.links[0]!.id);
  await page.getByLabel("Comment", { exact: true }).fill("My comment");
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(page.locator(".comment").filter({ hasText: "My comment" })).toBeVisible();
  const own = page.locator(".comment").filter({ hasText: "My comment" });
  await own.getByRole("button", { name: "Actions for comment by Alice" }).click();
  await page.getByRole("menuitem", { name: "Respond", exact: true }).click();
  await expect(page.getByLabel("Comment", { exact: true })).toHaveValue("@alice ");
  await own.getByRole("button", { name: "Actions for comment by Alice" }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(own).toHaveCount(0);
  // A link in a locked group stays with its owner: it shows the lock and can't be forwarded.
  await page.goto("/links/" + data.locked.id);
  await expect(page.getByRole("heading", { name: "Working notes", exact: true })).toBeVisible();
  await expect(page.locator(".post-label")).toContainText("Notes");
  await expect(page.locator(".post-label").getByLabel("Locked", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Forward", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Your profile", exact: true }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/login/);
  await page.goBack();
  await expect(page.getByText("Working notes", { exact: true })).toHaveCount(0);
});

test("editing a saved link changes its details, and a new address its category", async ({
  page,
}) => {
  await login(page);
  const own = page.locator('.week-page[data-active="true"] .own-links');
  const field = own.getByRole("textbox", { name: /Enter a link to add it/ });
  await field.fill("https://pages.test/calm-software");
  await field.press("Enter");
  // The fixture page declares a video and its site name, which is trimmed from the title.
  const row = own.locator(".link-row").filter({ hasText: "Calm Software" });
  await expect(row.locator(".category-mark")).toHaveAttribute("data-category", "video");
  await row.getByRole("button", { name: "Calm Software", exact: true }).click();
  const post = page.getByRole("dialog", { name: "Post", exact: true });
  await post.getByRole("link", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit link" });
  await expect(editor.getByLabel("Link", { exact: true })).toHaveValue(
    "https://pages.test/calm-software",
  );
  await editor.getByLabel("Title", { exact: true }).fill("");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(editor.getByText("Give the link a title.")).toBeVisible();
  await editor.getByLabel("Title", { exact: true }).fill("Calm notes");
  await editor.getByLabel("Note", { exact: true }).fill("For the reading group");
  await editor.getByLabel("Link", { exact: true }).fill("https://pages.test/calm-notes");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(editor).toHaveCount(0);
  const edited = own.locator(".link-row").filter({ hasText: "Calm notes" });
  // The new address is read again; this one says nothing, so the link is uncategorized.
  await expect(edited.locator(".category-mark")).toHaveAttribute("data-category", "uncategorized");
});

test("the editor goes back to the post it was opened from; closing closes both", async ({
  page,
}) => {
  await login(page);
  await page
    .locator('.week-page[data-active="true"] .own-links')
    .getByRole("button", { name: "Are.na", exact: true })
    .click();
  const post = page.getByRole("dialog", { name: "Post", exact: true }),
    editor = page.getByRole("dialog", { name: "Edit link", exact: true }),
    edit = post.getByRole("link", { name: "Edit", exact: true });
  await edit.click();
  // Focus moves into the editor, and back to Edit with the post.
  await expect(editor.getByRole("button", { name: /^Group:/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(edit).toBeFocused();
  await edit.click();
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(edit).toBeFocused();
  await edit.click();
  await editor.getByLabel("Title", { exact: true }).fill("Are.na, renamed");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(post.getByRole("heading", { name: "Are.na, renamed", exact: true })).toBeVisible();
  await edit.click();
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  // Opened on its own, the editor goes back to the page.
  await page.goto("/?edit=" + data.links[1]!.id);
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
});
test("Send link takes the post's place in its dialog and goes back to it", async ({ page }) => {
  await login(page);
  const row = page
    .locator('.week-page[data-active="true"] .own-links')
    .getByRole("button", { name: "Are.na", exact: true });
  await row.click();
  const post = page.getByRole("dialog", { name: "Post", exact: true }),
    send = page.getByRole("dialog", { name: "Send link", exact: true }),
    forward = post.getByRole("button", { name: "Forward", exact: true });
  await forward.click();
  await expect(
    send.locator(".send-link").getByRole("heading", { name: "Send link", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(send.getByRole("button", { name: "Back", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(forward).toBeFocused();
  await forward.click();
  await send.getByRole("button", { name: "Back", exact: true }).click();
  await expect(forward).toBeFocused();
  await forward.click();
  await send.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The next opening starts at the post.
  await row.click();
  await expect(forward).toBeVisible();
});
test("the editor's title field shows whole letters, however many lines it takes", async ({
  page,
}) => {
  await login(page);
  await page.goto("/?edit=" + data.links[0]!.id);
  const title = page.getByLabel("Title", { exact: true });
  // A field that scrolls at all clips its letters; ascenders and descenders reach past the
  // serif's tight line height.
  for (const value of ["Ågjpqy", "A title long enough to wrap onto a second line, with gjpqy"]) {
    await title.fill(value);
    expect(await title.evaluate((field) => field.scrollHeight - field.clientHeight)).toBe(0);
  }
});
test("Escape anywhere in the editor answers its question before leaving it", async ({ page }) => {
  await login(page);
  await page
    .locator('.week-page[data-active="true"] .own-links')
    .getByRole("button", { name: "Are.na", exact: true })
    .click();
  const post = page.getByRole("dialog", { name: "Post", exact: true }),
    editor = page.getByRole("dialog", { name: "Edit link", exact: true });
  await post.getByRole("link", { name: "Edit", exact: true }).click();
  const deleteLink = editor.getByRole("button", { name: "Delete link", exact: true });
  await deleteLink.click();
  await expect(editor.getByRole("alert")).toBeVisible();
  // The rest of the editor waits: its fields don't take focus.
  await editor.getByLabel("Title", { exact: true }).click({ force: true });
  await expect(editor.getByLabel("Title", { exact: true })).not.toBeFocused();
  // From wherever focus is, the first Escape cancels the question and the second leaves.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Escape");
  await expect(editor.getByRole("alert")).toHaveCount(0);
  await expect(deleteLink).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(post.getByRole("link", { name: "Edit", exact: true })).toBeVisible();
});
test("deleting a link from its editor closes it, or leaves the link's own page", async ({
  page,
}) => {
  await login(page);
  const own = page.locator('.week-page[data-active="true"] .own-links');
  const editor = page.getByRole("dialog", { name: "Edit link", exact: true }),
    deleteLink = editor.getByRole("button", { name: "Delete link", exact: true });
  const remove = async () => {
    await deleteLink.click();
    await editor.getByRole("button", { name: "Delete", exact: true }).click();
  };
  await own.getByRole("button", { name: "Are.na", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Post", exact: true })
    .getByRole("link", { name: "Edit", exact: true })
    .click();
  // The footer turns into the question, rather than a dialog opening on top.
  await deleteLink.click();
  await expect(editor.getByRole("alert")).toHaveText(
    "Delete the link, its comments and saved references?",
  );
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(editor.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(deleteLink).toBeFocused();
  await deleteLink.click();
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(deleteLink).toBeFocused();
  await expect(editor.getByRole("button", { name: "Save changes", exact: true })).toBeVisible();
  await remove();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(own.getByRole("button", { name: "Are.na", exact: true })).toHaveCount(0);
  // The post under the editor outlives its link while the dialog closes, without failing.
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
  await page.goto("/links/" + data.locked.id);
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await remove();
  await expect(page).toHaveURL(/\/u\/alice$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("pasting into the first row saves the link right away", async ({ page }) => {
  await login(page);
  const own = page.locator('.week-page[data-active="true"] .own-links');
  const field = own.getByRole("textbox", { name: /Enter a link to add it/ });
  // Real paste events carry clipboard data, which Playwright's fill() does not.
  const paste = (text: string) =>
    field.evaluate((input, value) => {
      const data = new DataTransfer();
      data.setData("text/plain", value);
      input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
    }, text);
  // Record the rows on every change: the pending row must turn into the saved one in place,
  // never showing both, which made the rows below jump.
  await own.evaluate((list) => {
    const snapshots: string[][] = [];
    (window as unknown as { rowSnapshots: string[][] }).rowSnapshots = snapshots;
    new MutationObserver(() =>
      snapshots.push([...list.querySelectorAll(".link-row")].map((row) => row.textContent ?? "")),
    ).observe(list, { subtree: true, childList: true, characterData: true });
  });
  await field.focus();
  await paste("https://pages.test/calm-software");
  await expect(field).toHaveValue("");
  const saved = own.locator(".link-row").filter({ hasText: "Calm Software" });
  await expect(saved).toHaveCount(1);
  const snapshots = await page.evaluate(
    () => (window as unknown as { rowSnapshots: string[][] }).rowSnapshots,
  );
  expect(
    snapshots.filter(
      (rows) =>
        rows.some((row) => row.includes("Fetching title")) &&
        rows.some((row) => row.includes("Calm Software")),
    ),
  ).toEqual([]);
  await expect(saved.locator(".category-mark")).toHaveAttribute("data-category", "video");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(saved).toHaveCount(0);
  // Text that is not a link is never saved; typed links save with Enter.
  await field.fill("not a link");
  await field.press("Enter");
  await expect(own.getByText("Enter a web link (https://…)")).toBeVisible();
  await field.fill("https://pages.test/calm-software");
  await field.press("Enter");
  await expect(saved).toHaveCount(1);
});

for (const width of [1440, 390]) {
  test(`recipient picker opens a single match directly at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    await page.getByRole("link", { name: "Messages", exact: true }).click();
    await page.getByRole("button", { name: "New message", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "New message", exact: true });
    // Bob's own row, not the group chat with him in it.
    const bob = picker
      .locator(".recipient-row")
      .filter({ has: page.getByText("Bob", { exact: true }) });
    await expect(bob.getByRole("checkbox")).toHaveCount(1);
    await bob.hover();
    await expect(bob.getByRole("checkbox")).toHaveCSS("opacity", "1");
    await expect(bob.getByRole("checkbox")).toHaveCSS("border-radius", "50%");
    const avatar = (await bob.locator(".user-avatar").boundingBox())!;
    const name = (await bob.locator(".person-label").boundingBox())!;
    expect(name.x - (avatar.x + avatar.width)).toBeLessThanOrEqual(16);
    const frame = (await picker.boundingBox())!;
    if (width > 700) expect(Math.abs(frame.y + frame.height / 2 - 450)).toBeLessThanOrEqual(1);
    await picker.getByRole("textbox", { name: "Search recipients" }).fill("Bob");
    await expect(picker.getByRole("checkbox")).toHaveCount(0);
    // The list filters inside a frame that neither moves nor resizes.
    expect(await picker.boundingBox()).toEqual(frame);
    await expect(picker.getByRole("button", { name: "Next", exact: true })).toHaveCount(0);
    await bob.click();
    await expect(page).toHaveURL(/\/messages\/[^/?]+/);
    await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeVisible();
    await expect(picker).toHaveCount(0);
  });
}
