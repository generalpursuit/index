import { apiURL } from "./urls";
import { test, expect, type Browser, type Locator, type Page } from "@playwright/test";
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
/** Real touch input, so the browser applies touch-action and derives pointer events. */
async function swipe(page: Page, target: Locator, from: number, distance: number) {
  const box = (await target.boundingBox())!,
    start = { x: box.x + from, y: box.y + box.height / 2 };
  const touch = await page.context().newCDPSession(page);
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
  for (let step = 1; step <= 10; step++)
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: start.x + (distance * step) / 10, y: start.y }],
    });
  const offset = await target.evaluate((element) =>
    element.closest(".message")!.getAttribute("style"),
  );
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  return offset ?? "";
}
async function phone(browser: Browser, reducedMotion: "reduce" | "no-preference") {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    reducedMotion,
  });
  const page = await context.newPage();
  await login(page);
  return page;
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

test("on touch screens Return adds a line and only the button sends", async ({ browser }) => {
  const page = await phone(browser, "no-preference");
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
  await page.goto("/messages/" + data.conversationId);
  const field = page.getByLabel("Message", { exact: true });
  await field.fill("First line");
  await field.press("Enter");
  await field.pressSequentially("Second line");
  await expect(field).toHaveValue("First line\nSecond line");
  await expect(page.locator(".message-bubble").last()).toHaveText("Same here.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator(".message-bubble").last()).toHaveText("First line\nSecond line");
  await expect(field).toHaveValue("");
  await page.context().close();
});

test("the message menu replies and copies, and a quote leads back to its original", async ({
  page,
  context,
  browser,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await login(page);
  await page.goto("/messages/" + data.conversationId);
  const original = page.locator(".message-bubble").filter({ hasText: "Adding it to my list." });
  await original.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Adding it to my list.");
  await original.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Reply", exact: true }).click();
  const chip = page.locator("form.composer .draft-reply");
  await expect(chip).toContainText("Replying to Bob");
  await expect(chip).toContainText("Adding it to my list.");
  await expect(page.getByLabel("Message", { exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Cancel reply", exact: true }).click();
  await expect(chip).toHaveCount(0);
  await original.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Reply", exact: true }).click();
  await page.getByLabel("Message", { exact: true }).fill("Same, and this one too");
  await page.keyboard.press("Enter");
  await expect(chip).toHaveCount(0);
  const reply = page.locator(".message.outgoing").last();
  await expect(reply.locator(".message-bubble")).toHaveText("Same, and this one too");
  const quote = reply.getByRole("button", { name: /^Replying to Bob/ });
  await expect(quote).toContainText("Adding it to my list.");
  await quote.click();
  await expect(page.locator(".message[data-highlighted]")).toContainText("Adding it to my list.");
  await expect(page.locator(".message[data-highlighted]")).toHaveCount(0);

  const bob = await browser.newContext();
  const recipient = await bob.newPage();
  await login(recipient, "bob");
  await recipient.goto("/messages/" + data.conversationId);
  await expect(recipient.locator(".message-quote").last()).toContainText("Replying to you");
  await bob.close();
});

test("the keyboard moves through messages as one tab stop and opens their menus and posts", async ({
  page,
}) => {
  await login(page);
  const link = data.links[2]!;
  await page.goto(`/messages/${data.conversationId}?attach=${link.id}`);
  const field = page.getByLabel("Message", { exact: true });
  await expect(page.locator(".draft-attachment")).toContainText(link.title);
  await field.fill("Look");
  await field.press("Enter");
  await expect(page.locator(".draft-attachment")).toHaveCount(0);
  const focused = page.locator(":focus"),
    at = String.raw` \w+,? \d+ \w+ \d{4} at \d\d:\d\d$`;
  const message = (text: string) =>
    page.getByRole("listitem").filter({ has: page.locator(".message-bubble", { hasText: text }) });
  // The list is entered at its newest message, which names its sender, content and time.
  await field.press("Shift+Tab");
  await expect(focused).toHaveAccessibleName(new RegExp(`^You Look ${link.title} .+${at}`));
  await page.keyboard.press("ArrowUp");
  await expect(focused).toHaveAccessibleName(new RegExp(`^Lena Same here\\.${at}`));
  await page.keyboard.press("Home");
  await expect(message("A place for good finds.")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(message("A place for good finds.")).toBeFocused();
  await page.keyboard.press("End");
  await expect(message("Look")).toBeFocused();
  // Enter opens the post a message carries.
  await page.keyboard.press("Enter");
  const post = page.getByRole("dialog", { name: "Post", exact: true });
  await expect(post.getByRole("heading", { name: link.title, exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(post).toHaveCount(0);

  // Shift+F10 opens the focused message's menu; replying hands focus to the composer.
  await message("Adding it to my list.").focus();
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Reply", exact: true })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Reply", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("form.composer .draft-reply")).toContainText("Replying to Bob");
  await expect(field).toBeFocused();
  await field.fill("Keyboard reply");
  await field.press("Enter");
  await expect(page.locator(".message-bubble").last()).toHaveText("Keyboard reply");

  // The list returns to the message focused last; Enter on a reply leads to its original.
  await field.press("Shift+Tab");
  await expect(message("Adding it to my list.")).toBeFocused();
  await page.keyboard.press("End");
  await expect(focused).toHaveAccessibleName(
    new RegExp(`^You Replying to Bob Adding it to my list\\. Keyboard reply${at}`),
  );
  await page.keyboard.press("Enter");
  await expect(message("Adding it to my list.")).toBeFocused();
  await expect(page.locator(".message[data-highlighted]")).toContainText("Adding it to my list.");

  // The ContextMenu key opens the menu too, and Escape returns to the message.
  await page.keyboard.press("ContextMenu");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(message("Adding it to my list.")).toBeFocused();
  // Tab leaves the list, past its quotes and posts, for the composer.
  await page.keyboard.press("Tab");
  await expect(field).toBeFocused();
});

test("swiping a message right replies on touch screens, leaving the edge to back", async ({
  browser,
}) => {
  const page = await phone(browser, "no-preference");
  await page.goto("/messages/" + data.conversationId);
  const chip = page.locator("form.composer .draft-reply");
  const bob = page.locator(".message-bubble").filter({ hasText: "Adding it to my list." });
  // A short swipe springs back without replying.
  expect(await swipe(page, bob, 20, 40)).toContain("translateX");
  await expect(chip).toHaveCount(0);
  await swipe(page, bob, 20, 140);
  await expect(chip).toContainText("Replying to Bob");
  await page.getByRole("button", { name: "Cancel reply", exact: true }).click();

  // A swipe from the screen edge goes back, even when it starts on a bubble.
  await page.goto("/messages/" + data.directConversationId);
  const incoming = page.locator(".message-bubble").filter({ hasText: "Not yet. Send it over?" });
  const left = (await incoming.boundingBox())!.x;
  expect(left).toBeLessThan(28);
  await swipe(page, incoming, 26 - left, 140);
  await expect(page).not.toHaveURL(/\/messages\//);
  await expect(chip).toHaveCount(0);
  await page.context().close();

  // Reduced motion keeps the message still while the reply icon appears.
  const still = await phone(browser, "reduce");
  await still.goto("/messages/" + data.conversationId);
  const message = still.locator(".message-bubble").filter({ hasText: "Same here." });
  expect(await swipe(still, message, 20, 140)).not.toContain("translateX");
  await expect(still.locator("form.composer .draft-reply")).toContainText("Replying to Lena");
  await still.context().close();
});

test("the newest message stays in view while the composer grows", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 520 });
  await login(page);
  await page.goto("/messages/" + data.conversationId);
  const field = page.getByLabel("Message", { exact: true });
  for (const body of ["One", "Two", "Three"]) {
    await field.fill(body);
    await field.press("Enter");
    await expect(page.locator(".message-bubble").last()).toHaveText(body);
  }
  const thread = page.locator(".chat-scroller"),
    newest = page.locator(".message-bubble").last();
  const inView = async () => {
    const [view, message] = [(await thread.boundingBox())!, (await newest.boundingBox())!];
    return message.y + message.height <= view.y + view.height + 1;
  };
  const draft = "A\nlonger\ndraft\nthat\ngrows\nthe\nfield";
  await field.fill(draft);
  await expect.poll(inView).toBe(true);
  await field.fill("");
  await expect.poll(inView).toBe(true);
  // A scroll is reported in the frame after it happens. When the composer grows before then,
  // that report already measures the smaller thread; the reader must still stay at the end.
  await field.evaluate(
    (textarea: HTMLTextAreaElement, text) =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          document.querySelector(".chat-scroller")!.scrollTop -= 1;
          setTimeout(() => {
            const value = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!;
            value.set!.call(textarea, text);
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
            resolve();
          });
        }),
      ),
    draft,
  );
  await expect(field).toHaveValue(draft);
  await expect.poll(inView).toBe(true);
});
