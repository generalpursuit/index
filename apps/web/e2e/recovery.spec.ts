import { apiURL } from "./urls";
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
  await page.getByLabel("Email or username", { exact: true }).fill("alice@test.example");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
}
test.beforeEach(async ({ request }) => {
  data = await (await request.post(apiURL + "/_test/reset")).json();
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
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit profile" });
  await editor.getByLabel("Name", { exact: true }).fill("Alice Example");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole("link", { name: "Your profile", exact: true }).click();
  await expect(page.locator(".profile-heading")).toContainText("Alice Example");
  const lists = page.getByRole("navigation", { name: "Lists" });
  await lists.getByRole("button", { name: "New group", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Research");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(lists.getByRole("link", { name: "Research", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // Groups are managed in Settings; the profile only shows and filters them.
  await page.goto("/settings");
  const lock = page.getByRole("button", { name: "Lock Research", exact: true });
  await expect(lock).toHaveAttribute("aria-pressed", "false");
  await lock.click();
  const confirmation = page.getByRole("alertdialog", { name: "Lock group?" });
  await expect(confirmation).toContainText("Only you can see this group and its links.");
  await confirmation.getByRole("button", { name: "Lock group", exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(lock).toHaveAttribute("aria-pressed", "true");
  await page.goto("/?edit=" + data.links[0]!.id);
  await page.getByRole("button", { name: /^Group:/ }).click();
  await page.getByRole("menuitemradio", { name: "Research", exact: true }).click();
  await expect(page.getByText("Only you will see this link.")).toBeVisible();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.goto("/people/" + data.people.Alice);
  await lists.getByRole("link", { name: "Research, only you", exact: true }).click();
  // The chip turns current as navigation starts; the Research list's add row shows it arrived.
  await expect(page.getByRole("button", { name: "Save destination: Research" })).toBeVisible();
  await expect(page.locator(".profile-links")).toContainText("Are.na");
  await page.getByRole("button", { name: /followers?$/ }).click();
  const lena = page.getByRole("dialog").locator(".person-row").filter({ hasText: "lena" });
  await lena.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(lena).toHaveCount(0);
  await page.getByRole("tab", { name: "Following", exact: true }).click();
  const bob = page.getByRole("dialog").locator(".person-row").filter({ hasText: "bob" });
  await bob.getByRole("button", { name: "Unfollow", exact: true }).click();
  await expect(bob).toHaveCount(0);
});
test("320px layout, edge swipe, and keyboard-accessible post dialog", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 667 });
  await login(page);
  await expect(page.locator('.week-page[data-active="true"] .friends-carousel')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await expect(page.locator('.week-page[data-active="true"] .own-links .link-row')).toHaveCount(5);
  await expect(
    page.locator('.week-page[data-active="true"] .friend-links').first().locator(".link-row"),
  ).toHaveCount(5);
  // The field takes a row on the smallest phones, so your fifth link scrolls under a fade;
  // the list still shows whole rows. Friends' lists fit.
  const own = page.locator('.week-page[data-active="true"] .own-links .link-list');
  await expect(own).toHaveAttribute("data-fade-end", "true");
  expect(await own.evaluate((el) => el.clientHeight % 36)).toBe(0);
  const friend = page.locator('.week-page[data-active="true"] .friend-links .link-list').first();
  expect(await friend.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
  const bottom = await page
      .locator('.week-page[data-active="true"] .friends-carousel')
      .boundingBox(),
    nav = await page.getByRole("navigation").boundingBox();
  expect(bottom!.y + bottom!.height).toBeLessThanOrEqual(nav!.y);
  await page.getByRole("link", { name: "Discover", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Discover", exact: true })).toBeVisible();
  await page.getByLabel("Search people").fill("Mia");
  await page.getByRole("link").filter({ hasText: "Mia" }).first().click();
  await expect(page.getByText("Only approved followers can see Mia’s links.")).toBeVisible();
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
  await expect(page).toHaveURL(/discover\?q=Mia$/);
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page
    .locator('.week-page[data-active="true"] .own-links')
    .getByRole("button", { name: "Are.na", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "Post", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("registration uses real authentication and preserves the requested destination", async ({
  page,
  request,
}) => {
  await page.goto("/login?next=%2Fdiscover");
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("New Reader");
  await page.getByLabel("Username", { exact: true }).fill("New_Reader");
  await page.getByLabel("Email", { exact: true }).fill("new-reader@test.example");
  await page.getByLabel("Password", { exact: true }).fill("new-reader-password");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  const messages = await (
    await request.get(apiURL + "/_test/mail?email=new-reader%40test.example")
  ).json();
  await page
    .getByLabel("Verification code")
    .fill(messages.findLast((m: { purpose: string }) => m.purpose === "verify").code);
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page).toHaveURL(/discover$/);
  await page.getByRole("link", { name: "Your profile" }).click();
  await expect(page.locator(".profile-heading h1")).toHaveText("New Reader");
  await expect(page.locator(".profile-meta")).toContainText("new_reader");
});
