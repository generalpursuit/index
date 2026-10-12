import { test, expect, type Page } from "@playwright/test";
import { DesktopHarness } from "./desktop-harness";
import { apiURL } from "./urls";
async function login(page: Page, identifier = "alice@test.example") {
  await page.goto("/login");
  await page.getByLabel("Email or username", { exact: true }).fill(identifier);
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
}
async function add(page: Page, url: string) {
  await page.getByRole("textbox", { name: "Add a link to this week" }).fill(url);
  await page.getByRole("textbox", { name: "Add a link to this week" }).press("Enter");
}

test("menu bar shares current-week data, group creation, duplicate flow and canonical main navigation", async ({
  page,
  context,
  request,
}) => {
  await request.post(apiURL + "/_test/reset");
  const desktop = new DesktopHarness();
  await desktop.attach(page, "main");
  await login(page);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 390, height: 560 });
  await desktop.attach(panel, "menu-bar");
  await panel.goto("/menu-bar");
  await expect(panel.getByRole("heading", { level: 1 })).toContainText("Week");
  await expect(
    panel.getByRole("button", { name: "Open Are.na in browser", exact: true }),
  ).toBeVisible();
  await expect(panel.getByRole("button", { name: /Open .*in browser/ })).toHaveCount(5);
  // The native panel hugs this week's content, and grows to its maximum for dialog sheets.
  const panelHeight = (command: string) =>
    desktop.commands.findLast((c) => c.label === "menu-bar" && c.command === command)?.args
      ?.height as number | undefined;
  await expect.poll(() => panelHeight("desktop_panel_resize")).toBeGreaterThan(300);
  const fitted = panelHeight("desktop_panel_resize")!;
  expect(fitted).toBeLessThan(560);
  expect(panelHeight("desktop_panel_ready")).toBeLessThan(560);
  await panel.getByRole("button", { name: "Open Are.na in browser", exact: true }).click();
  await expect.poll(() => desktop.opened).toContain("https://are.na/");
  await expect(panel).toHaveURL(/\/menu-bar$/);
  await panel.getByRole("button", { name: "Save destination: Your links" }).click();
  await expect.poll(() => panelHeight("desktop_panel_resize")).toBeGreaterThan(fitted);
  await panel.getByRole("button", { name: "Create group", exact: true }).click();
  await panel.getByRole("textbox", { name: "Name", exact: true }).fill("Menu reading");
  await panel.getByRole("button", { name: "Create", exact: true }).click();
  await expect(panel.getByRole("dialog")).toHaveAccessibleName("Save to");
  await panel.getByRole("button", { name: "Done", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Save destination: Menu reading" })).toBeFocused();
  await add(panel, "https://pages.test/calm-software");
  await expect(panel.getByText("Link added", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: /Open Calm Software in browser/ })).toBeVisible();
  await panel.getByRole("button", { name: "Open Index", exact: true }).click({ trial: true });
  await panel.getByRole("button", { name: "Quit", exact: true }).click({ trial: true });
  await expect
    .poll(async () => {
      const toastBox = await panel.locator("[data-sonner-toast]").last().boundingBox();
      const footerBox = await panel.locator("footer").boundingBox();
      return toastBox!.y + toastBox!.height - footerBox!.y;
    })
    .toBeLessThanOrEqual(0);
  await expect(
    page
      .locator(".week-page[data-active=true]")
      .getByRole("button", { name: "Calm Software", exact: true })
      .first(),
  ).toBeVisible();
  await add(panel, "https://pages.test/calm-software");
  await expect(panel.getByRole("dialog", { name: "Already saved" })).toBeVisible();
  await panel.getByRole("button", { name: "View existing", exact: true }).click();
  await expect(page).toHaveURL(/\/l\/[A-Za-z0-9_-]+$/);
  await expect(panel).toHaveURL(/\/menu-bar$/);
  await expect.poll(() => desktop.pending).toBeNull();
  await add(panel, "https://pages.test/calm-software");
  await panel.getByRole("button", { name: "Save again", exact: true }).click();
  await expect(panel.getByRole("dialog", { name: "Already saved" })).not.toBeVisible();
  await expect(panel.getByRole("button", { name: /Open Calm Software in browser/ })).toHaveCount(2);
  await panel.screenshot({ path: "test-results/menu-bar-compact.png" });
  await page.goto("/settings");
  await page.getByRole("radio", { name: "Dark", exact: true }).check();
  await expect(panel.locator("html")).toHaveAttribute("data-theme-preference", "dark");
  await expect
    .poll(() => desktop.appearances.filter((value) => value.label === "menu-bar").at(-1)?.resolved)
    .toBe("dark");
  await panel.screenshot({ path: "test-results/menu-bar-dark.png" });
  expect(
    desktop.commands.filter((c) => c.label === "menu-bar" && c.command.startsWith("notification_")),
  ).toHaveLength(0);
  expect(
    desktop.events.every((event) => JSON.stringify(event.payload).indexOf("signed") === -1),
  ).toBe(true);
});

test("menu session clears drafts and links across sign-out and account switching while cleanup stalls", async ({
  page,
  context,
  request,
}) => {
  await request.post(apiURL + "/_test/reset");
  const desktop = new DesktopHarness();
  await desktop.attach(page, "main");
  await login(page);
  const panel = await context.newPage();
  await desktop.attach(panel, "menu-bar");
  await panel.goto("/menu-bar");
  await expect(
    panel.getByRole("button", { name: "Open Are.na in browser", exact: true }),
  ).toBeVisible();
  await panel
    .getByRole("textbox", { name: "Add a link to this week" })
    .fill("https://alice-private-draft.example");
  await page.goto("/settings");
  let release!: () => void;
  desktop.stopCleanup = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/login/);
    await expect(
      panel.getByRole("button", { name: "Sign in to Index", exact: true }),
    ).toBeVisible();
    await expect(panel.getByRole("button", { name: /Open .*in browser/ })).toHaveCount(0);
    expect(desktop.token).toBeNull();
  } finally {
    release();
  }
  await login(page, "bob@test.example");
  await expect(panel.getByRole("heading", { level: 1 })).toContainText("Week");
  await expect(panel.getByRole("textbox", { name: "Add a link to this week" })).toHaveValue("");
  await expect(
    panel.getByRole("button", { name: "Open Are.na in browser", exact: true }),
  ).toHaveCount(0);
  // An out-of-order old event must not clear Bob's identity or refetch Alice.
  await desktop.emit("index:desktop-session", { revision: 1, source: "main" });
  await expect(panel.getByRole("textbox", { name: "Add a link to this week" })).toBeVisible();
});

test("menu shell forwards hide/Open/Quit without notification ownership; Settings owns login items", async ({
  page,
  context,
  request,
}) => {
  await request.post(apiURL + "/_test/reset");
  const desktop = new DesktopHarness();
  await desktop.attach(page, "main");
  await login(page);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 390, height: 560 });
  await desktop.attach(panel, "menu-bar");
  await panel.goto("/menu-bar");
  await expect(panel.getByRole("heading", { level: 1 })).toContainText("Week");
  await expect(panel.getByRole("checkbox", { name: "Launch at login" })).toHaveCount(0);
  await panel.getByRole("button", { name: "Open Index", exact: true }).click();
  await expect.poll(() => desktop.commands.some((c) => c.command === "desktop_open")).toBe(true);
  await panel.keyboard.press("Escape");
  await expect.poll(() => desktop.hidden).toContain("menu-bar");
  await panel.getByRole("button", { name: "Quit", exact: true }).click();
  await expect.poll(() => desktop.quits).toBe(1);
  expect(
    desktop.commands.filter((c) => c.label === "menu-bar" && c.command.startsWith("notification_")),
  ).toHaveLength(0);
  expect(desktop.commands.some((c) => c.command.startsWith("launch_at_login"))).toBe(false);

  await page.goto("/settings");
  const box = page.getByRole("region", { name: "Launch at login" });
  const checkbox = box.getByRole("checkbox", { name: "Launch at login" });
  await expect(checkbox).not.toBeChecked();
  expect(desktop.commands.some((c) => c.command === "launch_at_login_set")).toBe(false);
  await checkbox.click();
  await expect(
    box.getByText("Approval needed in System Settings.", { exact: false }),
  ).toBeVisible();
  await expect(checkbox).not.toBeChecked();
  await box.getByRole("button", { name: "Open Login Items" }).click();
  desktop.loginState = "enabled";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(checkbox).toBeChecked();
  desktop.loginError = true;
  await checkbox.click();
  await expect(box.getByRole("alert")).toContainText("Could not update Launch at login");
  await expect(checkbox).toBeChecked();
  desktop.loginError = false;
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();
  desktop.loginState = "unsupported";
  desktop.loginSupported = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(box).toHaveCount(0);
});

test("lost peer events cannot submit an old menu draft using a new account", async ({
  page,
  context,
  request,
}) => {
  await request.post(apiURL + "/_test/reset");
  const desktop = new DesktopHarness();
  await desktop.attach(page, "main");
  await login(page);
  const panel = await context.newPage();
  await desktop.attach(panel, "menu-bar");
  await panel.goto("/menu-bar");
  const input = panel.getByRole("textbox", { name: "Add a link to this week" });
  await input.fill("https://pages.test/calm-software");
  desktop.suppressed.add("menu-bar");
  // Reproduce a stalled hidden webview without a focus refresh before its stale action.
  await panel.evaluate(() => {
    window.addEventListener("focus", (event) => event.stopImmediatePropagation(), true);
  });
  await login(page, "bob@test.example");
  const writes: string[] = [];
  panel.on("request", (r) => {
    if (r.url().endsWith("/links/share")) writes.push(r.url());
  });
  await input.evaluate((element) =>
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  await expect(input).toHaveValue("");
  await expect(
    panel.getByRole("button", { name: "Open Are.na in browser", exact: true }),
  ).toHaveCount(0);
  expect(writes).toHaveLength(0);
});

test("held auth sign-out clears both windows before revocation and cannot erase a later login", async ({
  page,
  context,
  request,
}) => {
  await request.post(apiURL + "/_test/reset");
  const desktop = new DesktopHarness();
  await desktop.attach(page, "main");
  await login(page);
  const panel = await context.newPage();
  await desktop.attach(panel, "menu-bar");
  await panel.goto("/menu-bar");
  await expect(
    panel.getByRole("button", { name: "Open Are.na in browser", exact: true }),
  ).toBeVisible();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  await page.route("**/api/auth/sign-out", async (route) => {
    started = true;
    await held;
    await route.continue();
  });
  await page.goto("/settings");
  try {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect.poll(() => started).toBe(true);
    await expect(page).toHaveURL(/login/);
    await expect(
      panel.getByRole("button", { name: "Sign in to Index", exact: true }),
    ).toBeVisible();
    expect(desktop.token).toBeNull();
    await login(page, "bob@test.example");
    const bobToken = desktop.token;
    release();
    await expect(panel.getByRole("heading", { level: 1 })).toContainText("Week");
    await expect(
      panel.getByRole("button", { name: "Open Are.na in browser", exact: true }),
    ).toHaveCount(0);
    expect(desktop.token).toBe(bobToken);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
  } finally {
    release();
  }
});

test("a held old notification command cannot stop a new account registration", async ({
  page,
  request,
}) => {
  const fixture = await (await request.post(apiURL + "/_test/reset")).json();
  const desktop = new DesktopHarness();
  await desktop.attach(page, "main");
  await login(page);
  await page.goto("/settings");
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  desktop.heldNotification = { command: "notification_stop", revision: desktop.revision, wait };
  try {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/login/);
    await login(page, "bob@test.example");
    await page.goto("/settings");
    await page.getByRole("button", { name: "Enable on this device", exact: true }).click();
    await expect.poll(() => desktop.registeredAccount).toBe(fixture.people.Bob);
    const rejected = desktop.rejectedNotifications;
    release();
    await expect.poll(() => desktop.rejectedNotifications).toBeGreaterThan(rejected);
    expect(desktop.registeredAccount).toBe(fixture.people.Bob);
    await expect(page.getByText("Enabled on this device.", { exact: true })).toBeVisible();
  } finally {
    release();
  }
});

test("restricted menu keeps application data hidden and reflects same-account email verification", async ({
  page,
  context,
  request,
}) => {
  await request.post(apiURL + "/_test/reset");
  const desktop = new DesktopHarness();
  await desktop.attach(page, "main");
  await page.goto("/login");
  const panel = await context.newPage();
  await desktop.attach(panel, "menu-bar");
  await panel.goto("/menu-bar");
  const appRequests: string[] = [];
  panel.on("request", (r) => {
    if (r.url().includes("/rpc/v1/")) appRequests.push(r.url());
  });
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Menu reader");
  await page.getByLabel("Username", { exact: true }).fill("menu_reader");
  await page.getByLabel("Email", { exact: true }).fill("menu_reader@example.test");
  await page.getByLabel("Password", { exact: true }).fill("menu-reader-password");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  expect(appRequests).toHaveLength(0);
  await expect(panel.getByRole("textbox", { name: "Add a link to this week" })).toHaveCount(0);
  await panel.getByRole("button", { name: "Verify in Index" }).click();
  await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  let code: string | undefined;
  await expect
    .poll(async () => {
      const messages = await (
        await request.get(apiURL + "/_test/mail?email=menu_reader%40example.test")
      ).json();
      code = messages.findLast(
        (message: { purpose: string }) => message.purpose === "verify",
      )?.code;
      return !!code;
    })
    .toBe(true);
  await page.getByLabel("Verification code").fill(code!);
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(panel.getByRole("textbox", { name: "Add a link to this week" })).toBeVisible();
  await expect(panel.getByText("Save your first link for this week.")).toBeVisible();
});

test("menu retry survives hide/focus with its receipt and never substitutes a deleted destination", async ({
  page,
  context,
  request,
}) => {
  const fixture = await (await request.post(apiURL + "/_test/reset")).json();
  const desktop = new DesktopHarness();
  await desktop.attach(page, "main");
  await login(page);
  const panel = await context.newPage();
  await desktop.attach(panel, "menu-bar");
  await panel.goto("/menu-bar");
  await panel.getByRole("button", { name: "Save destination: Your links" }).click();
  await panel
    .getByRole("dialog", { name: "Save to", exact: true })
    .getByRole("button", { name: /Notes Only you/ })
    .click();
  const receipts: string[] = [];
  await panel.route("**/rpc/v1/links/share", async (route) => {
    receipts.push(route.request().postDataJSON().json.requestId);
    if (receipts.length === 1) {
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  const input = panel.getByRole("textbox", { name: "Add a link to this week" });
  await add(panel, "https://pages.test/calm-software");
  await expect(input).toHaveValue("https://pages.test/calm-software");
  await expect(panel.getByRole("alert")).toBeVisible();
  await input.blur();
  await panel.keyboard.press("Escape");
  await expect.poll(() => desktop.hidden).toContain("menu-bar");
  await desktop.emit("index:desktop-open", null, "menu-bar");
  await expect(input).toHaveValue("https://pages.test/calm-software");
  await input.press("Enter");
  await expect(
    panel.getByRole("button", { name: "Open Calm Software in browser", exact: true }),
  ).toHaveCount(1);
  await expect.poll(() => receipts.length).toBe(2);
  expect(receipts[0]).toBe(receipts[1]);
  await input.fill("https://pages.test/unsaved-private-draft");
  const removed = await request.delete(apiURL + `/api/v1/groups/${fixture.notes.id}`, {
    headers: { Authorization: `Bearer ${desktop.token}` },
    data: { deleteLinks: false },
  });
  expect(removed.ok()).toBe(true);
  await desktop.emit("index:desktop-data", { revision: desktop.revision, source: "main" });
  await expect(
    panel.getByRole("button", { name: "Save destination: Unavailable group" }),
  ).toBeVisible();
  await expect(input).toBeDisabled();
  await expect(input).toHaveValue("https://pages.test/unsaved-private-draft");
  await expect.poll(() => receipts.length).toBe(2);
});
