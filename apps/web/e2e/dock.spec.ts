import { test, expect, type Page } from "@playwright/test";
import { DesktopHarness } from "./desktop-harness";
import { apiURL } from "./urls";

async function openSettings(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email or username", { exact: true }).fill("alice@test.example");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await request.post(apiURL + "/_test/reset");
});

test("Dock setting reflects the native state, survives reload, and stays put on failure", async ({
  page,
}) => {
  const desktop = new DesktopHarness();
  await desktop.attach(page, "main");
  await openSettings(page);
  const show = page.getByRole("switch", { name: "Show in Dock", exact: true });
  const dock = page.locator(".settings-row").filter({ has: show });
  await expect(show).toBeChecked();
  await show.click();
  await expect(show).not.toBeChecked();
  expect(desktop.dockVisible).toBe(false);
  await page.reload();
  await expect(show).not.toBeChecked();

  desktop.dockError = true;
  await show.click();
  await expect(dock.getByRole("alert")).toHaveText(
    "Could not change the Dock setting. Please try again.",
  );
  await expect(show).not.toBeChecked();
  expect(desktop.dockVisible).toBe(false);
  desktop.dockError = false;
  await show.click();
  await expect(show).toBeChecked();
  await expect(dock.getByRole("alert")).toHaveCount(0);
  expect(desktop.dockVisible).toBe(true);
});

test("unsupported desktops hide the Dock setting", async ({ page }) => {
  const desktop = new DesktopHarness();
  desktop.dockSupported = false;
  await desktop.attach(page, "main");
  await openSettings(page);
  await expect
    .poll(() => desktop.commands.some(({ command }) => command === "dock_status"))
    .toBe(true);
  await expect(page.getByRole("switch", { name: "Show in Dock", exact: true })).toHaveCount(0);
});

test("browser settings do not offer the Dock setting", async ({ page }) => {
  await openSettings(page);
  await expect(page.getByRole("switch", { name: "Show in Dock", exact: true })).toHaveCount(0);
});
