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

test("app icon reflects native preference, survives reload, and preserves selection on failure", async ({
  page,
}, testInfo) => {
  const desktop = new DesktopHarness();
  await desktop.attach(page, "main");
  await openSettings(page);
  await expect(page.getByRole("radio", { name: "Ink", exact: true })).toBeChecked();
  await page.getByRole("radio", { name: "Paper", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Paper", exact: true })).toBeChecked();
  expect(desktop.appIcon).toBe("paper");
  await page
    .getByRole("group", { name: "App icon", exact: true })
    .screenshot({ path: testInfo.outputPath("app-icon-light.png") });
  await page.reload();
  await expect(page.getByRole("radio", { name: "Paper", exact: true })).toBeChecked();

  desktop.appIconError = true;
  // Selection is confirmed asynchronously by the OS; on failure it must stay unchanged.
  await page.getByRole("radio", { name: "Ink", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Could not change the app icon. Please try again.",
  );
  await expect(page.getByRole("radio", { name: "Paper", exact: true })).toBeChecked();
  expect(desktop.appIcon).toBe("paper");
  desktop.appIconError = false;
  await page.getByRole("radio", { name: "Ink", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Ink", exact: true })).toBeChecked();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(desktop.appIcon).toBe("ink");
  await page.getByRole("radio", { name: "Dark", exact: true }).check();
  await page
    .getByRole("group", { name: "App icon", exact: true })
    .screenshot({ path: testInfo.outputPath("app-icon-dark.png") });
});

test("unsupported desktops hide the app icon picker", async ({ page }) => {
  const desktop = new DesktopHarness();
  desktop.appIconSupported = false;
  await desktop.attach(page, "main");
  await openSettings(page);
  await expect
    .poll(() => desktop.commands.some(({ command }) => command === "app_icon_status"))
    .toBe(true);
  await expect(page.getByRole("group", { name: "App icon", exact: true })).toHaveCount(0);
});

test("browser settings do not offer a native app icon picker", async ({ page }) => {
  await openSettings(page);
  await expect(page.getByRole("group", { name: "App icon", exact: true })).toHaveCount(0);
});
