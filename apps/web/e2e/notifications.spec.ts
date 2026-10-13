import { test, expect, type Page } from "@playwright/test";
import { apiURL } from "./urls";
async function login(page: Page, account = "alice") {
  await page.goto("/login");
  await page.getByLabel("Email or username", { exact: true }).fill(account);
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
  await page.goto("/settings");
  await expect(page.getByRole("region", { name: "Notifications", exact: true })).toBeVisible();
}
test.beforeEach(async ({ request }) => {
  await request.post(apiURL + "/_test/reset");
});
test("account preferences persist, preserve activity and stay isolated after logout", async ({
  page,
}) => {
  await login(page);
  const settings = page.getByRole("region", { name: "Notifications", exact: true });
  await expect(settings.getByLabel("Messages", { exact: true })).toBeChecked();
  await expect(settings.getByLabel("Show message and comment previews")).not.toBeChecked();
  await settings.getByLabel("Messages", { exact: true }).click();
  await expect(settings.getByLabel("Messages", { exact: true })).not.toBeChecked();
  await expect(settings.getByLabel("Messages", { exact: true })).toBeEnabled();
  await settings.getByLabel("Show message and comment previews").click();
  await expect(settings.getByLabel("Show message and comment previews")).toBeChecked();
  await expect(settings.getByLabel("Show message and comment previews")).toBeEnabled();
  await page.reload();
  await expect(settings.getByLabel("Messages", { exact: true })).not.toBeChecked();
  await expect(settings.getByLabel("Show message and comment previews")).toBeChecked();
  await page.goto("/activity");
  await expect(page.getByRole("link", { name: "mia", exact: true })).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/login/);
  await login(page, "bob");
  await expect(settings.getByLabel("Messages", { exact: true })).toBeChecked();
  await expect(settings.getByLabel("Show message and comment previews")).not.toBeChecked();
});
test("followers controls both follow events and is on only when both are", async ({ page }) => {
  await login(page);
  const settings = page.getByRole("region", { name: "Notifications", exact: true });
  const followers = settings.getByLabel("Followers", { exact: true });
  const preferences = async () =>
    (await page.request.get(apiURL + "/api/v1/me/notifications/preferences")).json();
  await expect(followers).toBeChecked();
  await expect(followers).toHaveAccessibleDescription(
    "New followers, or follow requests while your profile is private",
  );
  await expect(settings.getByLabel("Accepted follow requests")).toHaveAccessibleDescription(
    "When someone approves your request to follow them",
  );
  await followers.click();
  await expect(followers).not.toBeChecked();
  await expect.poll(preferences).toMatchObject({ follow: false, request: false });
  const partial = await page.request.patch(apiURL + "/api/v1/me/notifications/preferences", {
    data: { request: true },
  });
  expect(partial.ok()).toBe(true);
  await page.reload();
  await expect(followers).not.toBeChecked();
  await followers.click();
  await expect(followers).toBeChecked();
  await expect.poll(preferences).toMatchObject({ follow: true, request: true });
});
test("permission is never requested on load and denial never appears enabled", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).permissionRequests = 0;
    let permission = "default";
    Object.defineProperty(Notification, "permission", { get: () => permission });
    Notification.requestPermission = async () => {
      (window as any).permissionRequests++;
      permission = "denied";
      return "denied";
    };
  });
  await login(page);
  const settings = page.getByRole("region", { name: "Notifications", exact: true });
  await expect(
    settings.getByText("Alerts are off. Permission has not been requested."),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).permissionRequests)).toBe(0);
  await settings.getByRole("button", { name: "Enable on this device" }).click();
  await expect(settings.getByText("Blocked in system or browser settings.")).toBeVisible();
  await expect(settings.getByRole("button", { name: "Enable on this device" })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).permissionRequests)).toBe(1);
});
test("unsupported browsers show preferences without pretending delivery is available", async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete (window as any).PushManager;
  });
  await login(page);
  const settings = page.getByRole("region", { name: "Notifications", exact: true });
  await expect(
    settings.getByText("Push notifications are not supported on this device or browser."),
  ).toBeVisible();
  await expect(settings.getByRole("button", { name: "Enable on this device" })).toHaveCount(0);
  await expect(settings.getByLabel("Comments", { exact: true })).toBeChecked();
});
test("iPhone and iPad Safari tabs point to the Home Screen app", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as any).PushManager;
    Object.defineProperty(Navigator.prototype, "standalone", { get: () => false });
  });
  await login(page);
  const settings = page.getByRole("region", { name: "Notifications", exact: true });
  await expect(settings.getByRole("status")).toHaveText(
    "Add Index to your Home Screen to turn on notifications.",
  );
  await expect(settings.getByRole("button", { name: "Enable on this device" })).toHaveCount(0);
});
test("device status waits for server capabilities and hides enabling when push is off", async ({
  page,
}) => {
  let answer!: () => void;
  const answered = new Promise<void>((resolve) => (answer = resolve));
  let hold = false;
  await page.route("**/rpc/v1/notifications/capabilities", async (route) => {
    // The page loader waits for this check. Failing it until the page is up leaves the
    // section checking again, as after a slow or flaky server.
    if (!hold) return route.abort();
    const response = await route.fetch();
    const body = await response.json();
    await answered;
    await route.fulfill({ response, json: { ...body, json: { ...body.json, web: false } } });
  });
  await login(page);
  hold = true;
  const settings = page.getByRole("region", { name: "Notifications", exact: true });
  const enable = settings.getByRole("button", { name: "Enable on this device" });
  // Let the device check finish while the server has not answered yet.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect(settings.getByRole("status")).toHaveText("Checking device permission…");
  await expect(enable).toHaveCount(0);
  answer();
  await expect(settings.getByRole("status")).toHaveText(
    "Notifications aren't available on this server yet.",
  );
  await expect(enable).toHaveCount(0);
});
test("opt-in registers the real worker, binds the current account, and unregisters on signout", async ({
  page,
  context,
  request,
}) => {
  await context.grantPermissions(["notifications"]);
  await page.addInitScript(() => {
    // Only the external provider is fake; the worker, session and subscription API are real.
    const subscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/isolated-browser-test",
      keys: { p256dh: "", auth: "" },
      toJSON() {
        return { endpoint: this.endpoint, keys: this.keys };
      },
      unsubscribe: async () => true,
    };
    PushManager.prototype.getSubscription = async () => null;
    PushManager.prototype.subscribe = async () => {
      const key = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
        "deriveBits",
      ]);
      const encode = (bytes: Uint8Array) =>
        btoa(String.fromCharCode(...bytes))
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replace(/=+$/, "");
      subscription.keys = {
        p256dh: encode(new Uint8Array(await crypto.subtle.exportKey("raw", key.publicKey))),
        auth: encode(crypto.getRandomValues(new Uint8Array(16))),
      };
      return subscription as unknown as PushSubscription;
    };
  });
  await login(page);
  const settings = page.getByRole("region", { name: "Notifications", exact: true });
  await expect(
    settings.getByText("Permission allowed. Alerts are off on this device."),
  ).toBeVisible();
  await settings.getByRole("button", { name: "Enable on this device" }).click();
  await expect(settings.getByText("Enabled on this device.")).toBeVisible();
  await page.reload();
  await expect(settings.getByText("Enabled on this device.")).toBeVisible();
  const worker = context.serviceWorkers()[0]!;
  await worker.evaluate(() => {
    const scope = globalThis as any;
    scope.shown = [];
    scope.registration.showNotification = async (title: string, options: unknown) => {
      scope.shown.push({ title, ...(options as object) });
    };
    scope.registration.getNotifications = async () =>
      scope.shown.map(() => ({
        close() {
          scope.shown = [];
        },
      }));
  });
  const { ids } = await (await request.post(apiURL + "/_test/notify")).json();
  expect(ids).toHaveLength(1);
  const push = () =>
    worker.evaluate(async (id: string) => {
      const scope = globalThis as any,
        work: Promise<unknown>[] = [];
      const event = new Event("push");
      Object.assign(event, {
        data: { json: () => ({ id }) },
        waitUntil: (p: Promise<unknown>) => work.push(p),
      });
      scope.dispatchEvent(event);
      await Promise.all(work);
      return scope.shown;
    }, ids[0]);
  const shown = await push();
  expect(shown).toHaveLength(1);
  expect(shown[0].body).toBe("You have a new message.");
  expect(JSON.stringify(shown)).not.toContain("PRIVATE");
  expect(await push()).toHaveLength(1); // persisted worker dedupe
  await worker.evaluate(async () => {
    const scope = globalThis as any,
      work: Promise<unknown>[] = [];
    const event = new Event("notificationclick");
    Object.assign(event, {
      notification: { data: scope.shown[0].data, close() {} },
      waitUntil: (p: Promise<unknown>) => work.push(p),
    });
    scope.dispatchEvent(event);
    await Promise.all(work);
  });
  await expect(page).toHaveURL(/\/messages\/[a-zA-Z0-9_-]+$/);
  await expect(page.getByText("PRIVATE browser fixture", { exact: true })).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/login/);
  await login(page, "bob");
  await expect(
    settings.getByText("Permission allowed. Alerts are off on this device."),
  ).toBeVisible();
  expect(await push()).toHaveLength(0);
});
