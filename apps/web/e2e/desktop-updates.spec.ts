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
}

test.beforeEach(async ({ request }) => {
  await request.post(apiURL + "/_test/reset");
});

test("staging identifies itself, confirms an update, shows progress and recovers from failure", async ({
  page,
}) => {
  const desktop = new DesktopHarness();
  desktop.releaseChannel = "staging";
  desktop.updatesEnabled = true;
  desktop.updateVersion = "0.1.43";
  await desktop.attach(page, "main");
  await openSettings(page);
  await expect(page.getByLabel("Index Staging", { exact: true })).toBeVisible();
  const updates = page.getByRole("region", { name: "Desktop updates" });
  await expect(updates).toContainText("Version 0.1.42");
  expect(
    desktop.commands.filter(({ command }) => command === "desktop_install_update"),
  ).toHaveLength(0);
  await updates.getByRole("button", { name: "Check for updates" }).click();
  let finish!: () => void;
  desktop.installWait = new Promise<void>((resolve) => {
    finish = resolve;
  });
  desktop.installError = true;
  await updates.getByRole("button", { name: "Install 0.1.43 and restart" }).click();
  await expect(updates.getByRole("button", { name: "Installing…", exact: true })).toBeDisabled();
  await desktop.emit("index:update-progress", 52);
  await expect(updates.getByRole("button", { name: "Installing 52%…" })).toBeDisabled();
  finish();
  await expect(updates.getByRole("alert")).toContainText("could not be verified or installed");
  await expect(updates.getByRole("button", { name: "Check for updates" })).toBeEnabled();
  const command = desktop.commands.find(({ command }) => command === "desktop_install_update");
  expect(command?.args).toEqual({ version: "0.1.43" });
  desktop.updateVersion = "0.1.44";
  await updates.getByRole("button", { name: "Check for updates" }).click();
  await expect(updates.getByRole("button", { name: "Install 0.1.44 and restart" })).toBeEnabled();
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
  await expect(updates).toContainText("Version 0.1.42");
  await expect(updates.getByRole("button")).toHaveCount(0);
  expect(desktop.commands.some(({ command }) => command === "desktop_check_update")).toBe(false);
});

test("web settings do not offer native updates", async ({ page }) => {
  await openSettings(page);
  await expect(page.getByRole("region", { name: "Desktop updates" })).toHaveCount(0);
});
