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
    await launcher.click();
    const picker = page.getByRole("dialog", { name: "Save to", exact: true });
    await expect(picker.getByRole("button", { name: /Starred|Favorites/ })).toHaveCount(0);
    await picker.getByRole("textbox", { name: "Search destinations" }).fill("no matching name");
    await picker.getByRole("button", { name: "Create group", exact: true }).click();
    const creation = page.getByRole("dialog", { name: "Create group", exact: true });
    await creation.getByRole("textbox", { name: "Name", exact: true }).fill("Shared reading");
    await creation.getByRole("button", { name: "Lock group", exact: true }).click();
    await creation.getByRole("button", { name: "Create", exact: true }).click();
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("button", { name: /Shared reading/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.screenshot({ path: `test-results/sharing-picker-${width}.png` });
    await picker.getByRole("button", { name: "Done", exact: true }).click();
    await expect(
      current(page).getByRole("button", { name: "Save destination: Shared reading" }),
    ).toBeFocused();
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
    await input(page).fill("https://pages.test/calm-software");
    await input(page).press("Enter");
    const duplicate = page.getByRole("dialog", { name: "Already saved", exact: true });
    await expect(duplicate.getByRole("button", { name: "View existing" })).toBeVisible();
    await duplicate.getByRole("button", { name: "Save again" }).click();
    await expect(duplicate).toHaveCount(0);
    await expect(
      current(page).getByRole("button", { name: "Calm Software", exact: true }),
    ).toHaveCount(2);
    expect(requests).toHaveLength(3);
    expect(requests.every((r) => r.groupId === requests[0]!.groupId && !!r.groupId)).toBe(true);
    expect(requests[2]!.saveAgain).toBe(true);
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
  // Escape before the picker is open is lost, and the open picker then keeps the field's Enter.
  const picker = page.getByRole("dialog", { name: "Save to", exact: true });
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
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
test("duplicate View existing resolves canonical post without another save", async ({ page }) => {
  await login(page);
  for (let i = 0; i < 2; i++) {
    await input(page).fill("https://pages.test/calm-software");
    await input(page).press("Enter");
    await expect(
      current(page).getByRole("button", { name: "Calm Software", exact: true }),
    ).toHaveCount(1);
  }
  await page
    .getByRole("dialog", { name: "Already saved" })
    .getByRole("button", { name: "View existing" })
    .click();
  await expect(page).toHaveURL(/\/l\/[A-Za-z0-9_-]{16}$/);
  await expect(page.getByRole("heading", { name: "Calm Software" })).toBeVisible();
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
  await launcher.click();
  let picker = page.getByRole("dialog", { name: "Save to", exact: true });
  await picker.getByRole("button", { name: /Share destination/ }).click();
  await expect(launcher).toHaveAttribute("aria-label", "Save destination: Share destination");
  const renamed = await page.request.patch(apiURL + `/api/v1/groups/${group.id}`, {
    data: { name: "Renamed collection", visibility: "public" },
  });
  expect(renamed.ok()).toBe(true);
  await launcher.click();
  picker = page.getByRole("dialog", { name: "Save to", exact: true });
  const row = picker.getByRole("button", { name: /Renamed collection/ });
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await expect(row).toContainText("Visible to anyone who can see your profile");
  await expect(row.getByLabel("Locked")).toHaveCount(0);
  await picker.getByRole("button", { name: "Done" }).click();
  await expect(launcher).toHaveAttribute("aria-label", "Save destination: Renamed collection");
  await input(page).fill("https://pages.test/calm-software");
  const deleted = await page.request.delete(apiURL + `/api/v1/groups/${group.id}`, {
    data: { deleteLinks: false },
  });
  expect(deleted.ok()).toBe(true);
  await launcher.click();
  picker = page.getByRole("dialog", { name: "Save to", exact: true });
  await expect(picker.getByRole("alert")).toContainText("unavailable");
  await picker.getByRole("button", { name: "Done" }).click();
  await expect(launcher).toHaveAttribute("aria-label", "Save destination: Unavailable group");
  await expect(input(page)).toBeDisabled();
  await expect(input(page)).toHaveValue("https://pages.test/calm-software");
  await launcher.click();
  await page
    .getByRole("dialog", { name: "Save to" })
    .getByRole("button", { name: /Your links/ })
    .click();
  await expect(input(page)).toBeEnabled();
  await input(page).press("Enter");
  await expect(
    current(page).getByRole("button", { name: "Calm Software", exact: true }),
  ).toBeVisible();
});
