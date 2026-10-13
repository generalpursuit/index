import { apiURL } from "./urls";
import { test, expect, type Locator, type Page } from "@playwright/test";
let data: {
  conversationId: string;
  directConversationId: string;
  links: { id: string; title: string }[];
};
async function login(page: Page, name = "alice") {
  await page.goto("/login");
  await page.getByLabel("Email or username", { exact: true }).fill(name + "@test.example");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
}
/** WCAG contrast between a child's text and the surface it is drawn on. */
function contrast(surface: Locator, text: string) {
  return surface.evaluate((element, selector) => {
    const luminance = (value: string) => {
      const [r, g, b] = value
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map((c) => {
          const s = Number(c) / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const [light, dark] = [
      luminance(getComputedStyle(element.querySelector(selector)!).color),
      luminance(getComputedStyle(element).backgroundColor),
    ].sort((x, y) => y - x);
    return (light! + 0.05) / (dark! + 0.05);
  }, text);
}
test.beforeEach(async ({ request }) => {
  data = await (await request.post(apiURL + "/_test/reset")).json();
});

test("runs sit under date stamps, groups name their senders and 1:1 chats show Read", async ({
  page,
}) => {
  await login(page);
  await page.goto("/messages/" + data.conversationId);
  const thread = page.locator(".chat-scroller");
  await expect(thread.locator(".message-stamp")).toHaveCount(1);
  await expect(thread.locator(".message-stamp")).toContainText("Today");
  const incoming = thread.locator(".message-run.incoming");
  await expect(incoming).toHaveCount(2);
  await expect(incoming.first()).toContainText("Bob");
  await expect(incoming.first().locator(".user-avatar")).toHaveCount(1);
  await expect(incoming.last()).toContainText("Lena");
  await expect(thread.locator(".message-receipt")).toHaveCount(0);

  await page.goto("/messages/" + data.directConversationId);
  await expect(thread.locator(".message-stamp")).toHaveText([/^Yesterday \d\d:\d\d$/, /^Today/]);
  await expect(thread.locator(".user-avatar")).toHaveCount(0);
  await expect(thread.locator(".message-run")).toHaveCount(3);
  await expect(thread.locator(".message").last()).toHaveAttribute("title", / at \d\d:\d\d$/);
  // Bob read Alice's latest message; a newer one is unread until he opens it.
  await expect(thread.locator(".message-receipt")).toHaveText("Read");
  await page.getByLabel("Message", { exact: true }).fill("One more thing");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(thread.locator(".message-run").last()).toContainText("One more thing");
  await expect(thread.locator(".message-run")).toHaveCount(3);
  await expect(thread.locator(".message-receipt")).toHaveCount(0);
});

test("sent link cards keep a readable surface in light and dark mode", async ({ page }) => {
  await login(page);
  const link = data.links[2]!;
  await page.goto(`/messages/${data.conversationId}?attach=${link.id}`);
  await expect(page.locator(".draft-attachment")).toContainText(link.title);
  await page.getByLabel("Message", { exact: true }).fill("Same, and this one too");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const card = page.locator(".message.outgoing").last().locator(".shared-post");
  await expect(card).toContainText(link.title);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    // Polled: the card's background eases into the new theme.
    for (const text of ["strong", "small"])
      await expect.poll(() => contrast(card, text)).toBeGreaterThanOrEqual(4.5);
  }
});

test("the composer holds its attachment, grows with Shift+Enter and ignores IME Enter", async ({
  page,
}) => {
  await login(page);
  const link = data.links[2]!;
  await page.goto(`/messages/${data.conversationId}?attach=${link.id}`);
  const composer = page.locator("form.composer");
  await expect(composer.locator(".draft-attachment")).toContainText(link.title);
  await expect(composer.getByRole("button", { name: "Send message", exact: true })).toBeVisible();
  const field = composer.getByRole("textbox", { name: "Message", exact: true });
  const height = (await field.boundingBox())!.height;
  await field.fill("Same, and this one too");
  await field.press("Shift+Enter");
  await field.pressSequentially("Second line");
  expect((await field.boundingBox())!.height).toBeGreaterThan(height);
  // Enter that confirms an IME composition must not send.
  await field.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(field).toHaveValue("Same, and this one too\nSecond line");
  await field.press("Enter");
  await expect(field).toHaveValue("");
  await expect(composer.locator(".draft-attachment")).toHaveCount(0);
  const sent = page.locator(".message.outgoing").last();
  await expect(sent.locator(".message-bubble")).toHaveText("Same, and this one too\nSecond line");
  await expect(sent.locator(".shared-post")).toContainText(link.title);
});
