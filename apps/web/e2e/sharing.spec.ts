import { test, expect, type Page } from "@playwright/test";
import { apiURL } from "./urls";
async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email or username", { exact: true }).fill("alice");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
}
const current = (page: Page) => page.locator('.week-page[data-active="true"]');
const input = (page: Page) =>
  current(page).getByRole("textbox", { name: /Enter a link to add it/ });
const alreadySaved = (page: Page) =>
  current(page).getByRole("status").filter({ hasText: "Already saved this week" });
test.beforeEach(async ({ request }) => {
  await request.post(apiURL + "/_test/reset");
});
for (const width of [1440, 390]) {
  test(`destination create/select, immediate paste, duplicates at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.addInitScript(() => localStorage.setItem("index.theme", "dark"));
    await login(page);
    const launcher = current(page).getByRole("button", {
      name: "Save destination: Your links",
      exact: true,
    });
    // Your links never shows a lock, even though Alice's profile is private.
    await expect(launcher.locator(".lucide-lock-keyhole")).toHaveCount(0);
    await launcher.click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitemradio", { name: "Your links" })).toBeChecked();
    await expect(menu.getByRole("menuitemradio", { name: /Starred|Favorites/ })).toHaveCount(0);
    await expect(menu.getByRole("textbox")).toHaveCount(0);
    await page.screenshot({ path: `test-results/sharing-menu-${width}.png` });
    await menu.getByRole("menuitem", { name: "New group…", exact: true }).click();
    const creation = page.getByRole("dialog", { name: "New group", exact: true });
    await creation.getByRole("textbox", { name: "Name", exact: true }).fill("Shared reading");
    await creation.getByRole("button", { name: "Lock group", exact: true }).click();
    await creation.getByRole("button", { name: "Create", exact: true }).click();
    await expect(creation).toHaveCount(0);
    const chosen = current(page).getByRole("button", {
      name: "Save destination: Shared reading",
    });
    await expect(chosen).toBeFocused();
    // The lock is drawn for sight and spoken for screen readers.
    await expect(chosen.locator(".lucide-lock-keyhole")).toHaveCount(1);
    await expect(chosen).toHaveAccessibleName("Save destination: Shared reading, only you");
    const requests: {
      requestId: string;
      groupId: string | null;
      url: string;
      saveAgain: boolean;
    }[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/links/share")) requests.push(request.postDataJSON().json);
    });
    await input(page).evaluate((element) => {
      const data = new DataTransfer();
      data.setData("text", "https://pages.test/calm-software");
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
    });
    await expect(
      current(page).getByRole("button", { name: "Calm Software", exact: true }),
    ).toHaveCount(1);
    await expect(input(page)).toHaveValue("");
    // Home lists every destination, so the toast says where the link went.
    await expect(page.getByText("Link added to Shared reading", { exact: true })).toBeVisible();
    await input(page).fill("https://pages.test/calm-software");
    await input(page).press("Enter");
    // The link stays in the field, described by a quiet line, ready for a second Enter.
    await expect(input(page)).toHaveValue("https://pages.test/calm-software");
    await expect(input(page)).toHaveAccessibleDescription(
      "Already saved this week. Enter to save again · View",
    );
    await expect(alreadySaved(page).locator("kbd")).toHaveText("↵");
    await expect(input(page)).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Another destination may be chosen first; the earlier save stays where it is.
    await chosen.click();
    await page.getByRole("menuitemradio", { name: "Your links", exact: true }).click();
    await expect(alreadySaved(page)).toBeVisible();
    await input(page).press("Enter");
    await expect(alreadySaved(page)).toHaveCount(0);
    await expect(input(page)).toHaveValue("");
    await expect(page.getByText("Link added to Your links", { exact: true })).toBeVisible();
    await expect(
      current(page).getByRole("button", { name: "Calm Software", exact: true }),
    ).toHaveCount(2);
    expect(requests).toHaveLength(3);
    expect(requests[1]!.groupId).toBe(requests[0]!.groupId);
    expect(requests[0]!.groupId).toBeTruthy();
    expect(requests.map((r) => r.saveAgain)).toEqual([false, false, true]);
    expect(requests[2]!.groupId).toBeNull();
    expect(new Set(requests.map((r) => r.requestId)).size).toBe(3);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
  });
}
test("lost response retains input and retry ID; cancellation does not save", async ({ page }) => {
  await login(page);
  let calls = 0;
  const ids: string[] = [];
  await page.route("**/rpc/v1/links/share", async (route) => {
    calls++;
    ids.push(route.request().postDataJSON().json.requestId);
    if (calls === 1) {
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  const before = await current(page).locator(".own-links .link-row").count();
  await current(page).getByRole("button", { name: "Save destination: Your links" }).click();
  // Escape before the menu is open is lost, and the open menu then keeps the field's Enter.
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  expect(calls).toBe(0);
  await input(page).fill("https://pages.test/calm-software");
  await input(page).press("Enter");
  await expect(input(page)).toHaveValue("https://pages.test/calm-software");
  await expect(current(page).getByRole("alert")).toBeVisible();
  await input(page).press("Enter");
  await expect(
    current(page).getByRole("button", { name: "Calm Software", exact: true }),
  ).toHaveCount(1);
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  await expect(current(page).locator(".own-links .link-row")).toHaveCount(before + 1);
});
test("a duplicate ends with an edit or Escape, and View resolves the canonical post", async ({
  page,
}) => {
  await login(page);
  const again: boolean[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/links/share")) again.push(request.postDataJSON().json.saveAgain);
  });
  const duplicate = async () => {
    await input(page).fill("https://pages.test/calm-software");
    await input(page).press("Enter");
    await expect(alreadySaved(page)).toBeVisible();
  };
  await input(page).fill("https://pages.test/calm-software");
  await input(page).press("Enter");
  await expect(
    current(page).getByRole("button", { name: "Calm Software", exact: true }),
  ).toHaveCount(1);
  await duplicate();
  await input(page).press("Backspace");
  await expect(alreadySaved(page)).toHaveCount(0);
  await expect(input(page)).not.toHaveAttribute("aria-describedby");
  await duplicate();
  await input(page).press("Escape");
  await expect(alreadySaved(page)).toHaveCount(0);
  await expect(input(page)).toHaveValue("");
  await duplicate();
  await alreadySaved(page).getByRole("button", { name: "View", exact: true }).click();
  await expect(page).toHaveURL(/\/l\/[A-Za-z0-9_-]{16}$/);
  await expect(page.getByRole("heading", { name: "Calm Software" })).toBeVisible();
  expect(again).toEqual([false, false, false, false]);
});

test("selected group refreshes rename/privacy and deletion requires a fresh choice", async ({
  page,
}) => {
  await login(page);
  const created = await page.request.post(apiURL + "/api/v1/groups", {
    data: { name: "Share destination", visibility: "private" },
  });
  const group = await created.json();
  expect(created.ok()).toBe(true);
  const launcher = current(page).getByRole("button", { name: /^Save destination:/ });
  const menu = page.getByRole("menu");
  await launcher.click();
  const row = menu.getByRole("menuitemradio", { name: "Share destination" });
  await expect(row.locator(".lucide-lock-keyhole")).toHaveCount(1);
  await expect(row).toHaveAccessibleName("Share destination, only you");
  await expect(menu.getByRole("menuitemradio", { name: "Your links" })).toHaveAccessibleName(
    "Your links",
  );
  await row.click();
  await expect(menu).toHaveCount(0);
  await expect(launcher).toHaveAccessibleName("Save destination: Share destination, only you");
  const renamed = await page.request.patch(apiURL + `/api/v1/groups/${group.id}`, {
    data: { name: "Renamed collection", visibility: "public" },
  });
  expect(renamed.ok()).toBe(true);
  await launcher.click();
  const changed = menu.getByRole("menuitemradio", { name: "Renamed collection" });
  await expect(changed).toBeChecked();
  await expect(changed.locator(".lucide-lock-keyhole")).toHaveCount(0);
  await expect(changed).toHaveAccessibleName("Renamed collection");
  await page.keyboard.press("Escape");
  await expect(launcher).toHaveAttribute("aria-label", "Save destination: Renamed collection");
  await expect(launcher.locator(".lucide-lock-keyhole")).toHaveCount(0);
  await input(page).fill("https://pages.test/calm-software");
  const deleted = await page.request.delete(apiURL + `/api/v1/groups/${group.id}`, {
    data: { deleteLinks: false },
  });
  expect(deleted.ok()).toBe(true);
  await launcher.click();
  await expect(current(page).getByRole("alert")).toContainText("unavailable");
  await expect(menu.getByRole("menuitemradio", { checked: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(launcher).toHaveAttribute("aria-label", "Save destination: Unavailable group");
  await expect(input(page)).toBeDisabled();
  await expect(input(page)).toHaveValue("https://pages.test/calm-software");
  await launcher.click();
  await menu.getByRole("menuitemradio", { name: "Your links" }).click();
  await expect(input(page)).toBeEnabled();
  await input(page).press("Enter");
  await expect(
    current(page).getByRole("button", { name: "Calm Software", exact: true }),
  ).toBeVisible();
});
