import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { DesktopHarness } from "./desktop-harness";
import { apiURL } from "./urls";

const { version } = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
) as { version: string };

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
/** Keep the real response's CORS headers, but answer as an API that requires an update. */
async function requireUpdate(page: Page) {
  await page.route("**/rpc/v1/**", async (route) =>
    route.fulfill({
      response: await route.fetch(),
      status: 426,
      json: { code: "CLIENT_UPDATE_REQUIRED", message: "Update Index to continue." },
    }),
  );
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
  const updates = page.getByRole("group", { name: "Desktop updates" });
  await expect(updates.getByText("Index Staging", { exact: true })).toBeVisible();
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
  const updates = page.getByRole("group", { name: "Desktop updates" });
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
  const updates = page.getByRole("group", { name: "Desktop updates" });
  await expect(updates.getByText("Index", { exact: true })).toBeVisible();
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
  const updates = page.getByRole("group", { name: "Desktop updates" });
  await expect(updates).toContainText("Version 0.2.0");
  await expect(updates.getByRole("button")).toHaveCount(0);
  expect(desktop.commands.some(({ command }) => command === "desktop_check_update")).toBe(false);
});

test("web settings do not offer native updates", async ({ page }) => {
  await openSettings(page);
  await expect(page.getByRole("group", { name: "Desktop updates" })).toHaveCount(0);
});

test("web identifies its release and reloads when the API requires an update", async ({ page }) => {
  const identified = page.waitForRequest(
    (request) =>
      request.url().includes("/rpc/v1/") &&
      request.headers()["x-index-client"] === `web/${version}`,
  );
  await login(page);
  await identified;
  await requireUpdate(page);
  await page.reload();
  const dialog = page.getByRole("alertdialog", { name: "Update Index" });
  await expect(dialog).toContainText("no longer supported");
  // The app keeps starting behind the dialog; let its in-flight reads get their 426 first.
  await page.unrouteAll({ behavior: "wait" });
  await dialog.getByRole("button", { name: "Reload" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
  await expect(dialog).toHaveCount(0);
});

test("desktop restarts into the required update and can retry", async ({ page }) => {
  const desktop = new DesktopHarness();
  desktop.releaseChannel = "production";
  desktop.updatesEnabled = true;
  desktop.restartError = true;
  await desktop.attach(page, "main");
  const identified = page.waitForRequest(
    (request) => request.headers()["x-index-client"] === `desktop/${version}`,
  );
  await login(page);
  await identified;
  await requireUpdate(page);
  await page.reload();
  const dialog = page.getByRole("alertdialog", { name: "Update Index" });
  await expect(dialog.getByRole("alert")).toContainText("isn’t available yet");
  desktop.restartError = false;
  await dialog.getByRole("button", { name: "Try again" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Updating Index…");
  expect(
    desktop.commands.filter(({ command }) => command === "desktop_restart_to_update"),
  ).toHaveLength(2);
});
