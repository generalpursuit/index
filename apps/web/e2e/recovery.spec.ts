import { test, expect, type Page } from "@playwright/test";
let data: {
  people: Record<string, string>;
  reading: { id: string };
  notes: { id: string };
  links: { id: string }[];
  conversationId: string;
};
async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("alice@test.example");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
}
test.beforeEach(async ({ request }) => {
  data = await (await request.post("http://localhost:3002/_test/reset")).json();
});
test("failed send preserves the draft and retry creates exactly one message", async ({ page }) => {
  await login(page);
  await page.goto("/messages/" + data.conversationId);
  await page.getByLabel("Message", { exact: true }).fill("Keep this draft");
  await page.route("**/rpc/v1/messages/send", (route) => route.abort("failed"));
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Your draft is safe" })).toBeVisible();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("Keep this draft");
  await page.unroute("**/rpc/v1/messages/send");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message-bubble").filter({ hasText: "Keep this draft" })).toHaveCount(
    1,
  );
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("");
  await page.reload();
  await expect(page.locator(".message-bubble").filter({ hasText: "Keep this draft" })).toHaveCount(
    1,
  );
});
test("edit profile, create and lock a group, move a link, then remove a follower", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("link", { name: "Your profile" }).click();
  await page.getByRole("button", { name: "Edit profile" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Alice Example");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".profile-heading")).toContainText("Alice Example");
  await page.getByRole("button", { name: "Create group", exact: true }).click();
  await page.getByLabel("Group name").fill("Research");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("button", { name: "Research", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Unlocked", exact: true }).click();
  await expect(page.getByRole("button", { name: "Locked", exact: true })).toBeVisible();
  await page.goto("/add?edit=" + data.links[0]!.id);
  await page.getByRole("combobox", { name: "Group", exact: true }).click();
  await page.getByRole("option", { name: "Research", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.goto("/people/" + data.people.Alice);
  await page.getByRole("button", { name: "Research", exact: true }).click();
  await expect(page.locator(".profile-links")).toContainText("Are.na");
  await page.getByRole("button", { name: /followers$/ }).click();
  const lena = page.getByRole("dialog").locator(".person-row").filter({ hasText: "lena" });
  await lena.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(lena).toHaveCount(0);
  await page.getByRole("tab", { name: "Following", exact: true }).click();
  const bob = page.getByRole("dialog").locator(".person-row").filter({ hasText: "bob" });
  await bob.getByRole("button", { name: "Unfollow", exact: true }).click();
  await expect(bob).toHaveCount(0);
});
test("320px layout, edge swipe, full-page add, and keyboard-accessible post dialog", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 667 });
  await login(page);
  await expect(page.locator('.week-page[data-active="true"] .friends-carousel')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
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
  const bottom = await page
      .locator('.week-page[data-active="true"] .friends-carousel')
      .boundingBox(),
    nav = await page.getByRole("navigation").boundingBox();
  expect(bottom!.y + bottom!.height).toBeLessThanOrEqual(nav!.y);
  await page.getByRole("link", { name: "Discover", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Discover", exact: true })).toBeVisible();
  await page.getByLabel("Search people").fill("Mia");
  await page.getByRole("link").filter({ hasText: "Mia" }).first().click();
  await expect(page.getByText("Only Mia’s followers can view their posts.")).toBeVisible();
  await page.locator(".app-main").evaluate((el) => {
    el.dispatchEvent(
      new TouchEvent("touchstart", {
        bubbles: true,
        touches: [new Touch({ identifier: 0, target: el, clientX: 8, clientY: 180 })],
      }),
    );
    el.dispatchEvent(
      new TouchEvent("touchend", {
        bubbles: true,
        changedTouches: [new Touch({ identifier: 0, target: el, clientX: 150, clientY: 185 })],
      }),
    );
  });
  await expect(page).toHaveURL(/discover/);
  await page.getByRole("link", { name: "Add link", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add link", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page
    .locator('.week-page[data-active="true"] .own-links')
    .getByRole("button", { name: /Are.na are.na/ })
    .click();
  await expect(page.getByRole("dialog", { name: "Post", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("registration uses real authentication and preserves the requested destination", async ({
  page,
}) => {
  await page.goto("/login?next=%2Fdiscover");
  await page.getByRole("button", { name: "New here? Create an account" }).click();
  await page.getByLabel("Name", { exact: true }).fill("New Reader");
  await page.getByLabel("Email", { exact: true }).fill("new-reader@test.example");
  await page.getByLabel("Password", { exact: true }).fill("new-reader-password");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/discover$/);
  await page.getByRole("link", { name: "Your profile" }).click();
  await expect(page.locator(".profile-heading")).toContainText("New Reader");
});
