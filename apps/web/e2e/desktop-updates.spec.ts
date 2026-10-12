import { test, expect, type Page } from "@playwright/test";
import { DesktopHarness } from "./desktop-harness";
import { apiURL } from "./urls";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email or username", { exact: true }).fill("alice@test.example");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
}
async function openSettings(page: Page) {
  await login(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
}

test.beforeEach(async ({ request }) => {
  await request.post(apiURL + "/_test/reset");
});

test("staging prepares updates silently and offers to restart into them", async ({ page }) => {
  const desktop = new DesktopHarness();
  desktop.releaseChannel = "staging";
  desktop.releaseVersion = "0.2.0-staging.42";
  desktop.updatesEnabled = true;
  desktop.updateVersion = "0.2.0-staging.43";
  await desktop.attach(page, "main");
  await openSettings(page);
  await expect(page.getByLabel("Index Staging", { exact: true })).toHaveCount(0);
  const updates = page.getByRole("region", { name: "Desktop updates" });
  await expect(updates.getByRole("heading", { name: "Index Staging", exact: true })).toBeVisible();
  await expect(updates).toContainText("Version 0.2.0-staging.42");
  await updates.getByRole("button", { name: "Check for updates" }).click();
  await expect(updates.getByRole("status")).toHaveText(
    "Index 0.2.0-staging.43 is ready. It applies the next time Index opens.",
  );
  desktop.restartError = true;
  await updates.getByRole("button", { name: "Restart now" }).click();
  await expect(updates.getByRole("alert")).toContainText("isn’t available yet");
  desktop.restartError = false;
  await updates.getByRole("button", { name: "Restart now" }).click();
  await expect(updates.getByRole("button", { name: "Restarting…" })).toBeDisabled();
  expect(desktop.commands.some(({ command }) => command === "desktop_restart_to_update")).toBe(
    true,
  );
});

test("an update prepared in the background appears without a prompt", async ({ page }) => {
  const desktop = new DesktopHarness();
  desktop.releaseChannel = "production";
  desktop.updatesEnabled = true;
  await desktop.attach(page, "main");
  await openSettings(page);
  const updates = page.getByRole("region", { name: "Desktop updates" });
  await expect(updates.getByRole("button", { name: "Check for updates" })).toBeVisible();
  await desktop.emit("index:update-ready", "0.2.1");
  await expect(updates.getByRole("status")).toContainText("Index 0.2.1 is ready.");
  await expect(updates.getByRole("button", { name: "Restart now" })).toBeEnabled();
  expect(desktop.commands.some(({ command }) => command === "desktop_restart_to_update")).toBe(
    false,
  );
});

test("production remains unbadged and recovers from an offline update check", async ({ page }) => {
  const desktop = new DesktopHarness();
  desktop.releaseChannel = "production";
  desktop.updatesEnabled = true;
  desktop.updateError = true;
  await desktop.attach(page, "main");
  await openSettings(page);
  const updates = page.getByRole("region", { name: "Desktop updates" });
  await expect(updates.getByRole("heading", { name: "Index", exact: true })).toBeVisible();
  await expect(page.getByLabel("Index Staging", { exact: true })).toHaveCount(0);
  await updates.getByRole("button", { name: "Check for updates" }).click();
  await expect(updates.getByRole("alert")).toContainText("Could not check for updates");
  desktop.updateError = false;
  await updates.getByRole("button", { name: "Check for updates" }).click();
  await expect(updates.getByRole("status")).toHaveText("You’re up to date.");
  await expect(updates.getByRole("alert")).toHaveCount(0);
});

test("development and package-manager builds have no install action", async ({ page }) => {
  const desktop = new DesktopHarness();
  await desktop.attach(page, "main");
  await openSettings(page);
  const updates = page.getByRole("region", { name: "Desktop updates" });
  await expect(updates).toContainText("Version 0.2.0");
  await expect(updates.getByRole("button")).toHaveCount(0);
  expect(desktop.commands.some(({ command }) => command === "desktop_check_update")).toBe(false);
});

test("web settings do not offer native updates", async ({ page }) => {
  await openSettings(page);
  await expect(page.getByRole("region", { name: "Desktop updates" })).toHaveCount(0);
});
