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
  data = await (await request.post("http://localhost:3002/_test/reset")).json();
});
test("single-week layout, scrolling, add page and Favorites", async ({ page }) => {
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
  await expect(page).toHaveURL(new RegExp(data.older));
  await expect(page.locator('.week-page[data-active="true"] .own-links')).toContainText(
    "Earlier notes",
  );
  await expect(page.locator('.week-page[data-active="true"] .own-links')).not.toContainText(
    "Are.na",
  );
  await page.getByRole("button", { name: "Newer week" }).click();
  await expect(page).toHaveURL(new RegExp(data.week));
  await page
    .locator('.week-page[data-active="true"] .own-links')
    .getByRole("link", { name: /Add link to/ })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Add link" })).toBeVisible();
  await page.getByLabel("URL", { exact: true }).fill("https://example.com/new");
  await page.getByLabel("Title", { exact: true }).fill("A new find");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.locator('.week-page[data-active="true"] .own-links')).toContainText(
    "A new find",
  );
  await page.getByRole("button", { name: "Actions for A new find", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add to Favorites" }).click();
  await page.getByRole("link", { name: "Your profile", exact: true }).click();
  await page.getByRole("button", { name: "Favorites", exact: true }).click();
  await expect(page.locator(".profile-links")).toContainText("A new find");
  await expect(page.getByRole("button", { name: "Favorites", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
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
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/discover/);
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(page.getByRole("link", { name: "Messages", exact: true })).toBeHidden();
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
  await page.getByRole("combobox", { name: "Profile visibility" }).click();
  await page.getByRole("option", { name: "Public", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Make profile public?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Profile visibility" })).toContainText("Private");
  await page.getByRole("button", { name: /followers$/ }).click();
  await expect(page.getByRole("dialog")).toContainText("mia");
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
});
test("forward to multiple recipients, restricted card and member reply", async ({
  page,
  browser,
}) => {
  await login(page);
  await page.goto("/links/" + data.privateLink.id);
  await page
    .getByRole("button", { name: "Actions for " + data.privateLink.title, exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Forward", exact: true }).click();
  await page.getByRole("checkbox", { name: "Bob", exact: true }).click();
  await page.getByRole("checkbox", { name: "Lena", exact: true }).click();
  await page.getByRole("button", { name: "Next (2)", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("/messages/" + data.conversationId));
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
  await page.goto("/links/" + data.locked.id);
  await page.getByRole("button", { name: "Actions for Working notes", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Forward", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/login/);
  await page.goBack();
  await expect(page.getByText("Working notes", { exact: true })).toHaveCount(0);
});
