import { DesktopHarness } from "./desktop-harness";
import { apiURL } from "./urls";
import { test, expect } from "@playwright/test";

test("desktop bridge uses bearer auth, restores login, opens websites and erases logout", async ({
  page,
  request,
  context,
}) => {
  await request.post(apiURL + "/_test/reset");
  const desktop = new DesktopHarness();
  await desktop.attach(page, "main");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/login");
  await expect
    .poll(() => desktop.appearances.at(-1))
    .toEqual({ label: "main", preference: "system", resolved: "dark" });
  await page.getByLabel("Email or username", { exact: true }).fill("alice@test.example");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
  expect(desktop.token).toContain(".");
  expect(await context.cookies(apiURL + "")).toHaveLength(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
  // The domain in a row opens the website directly.
  await page.getByRole("link", { name: "are.na", exact: true }).click();
  await expect.poll(() => desktop.opened.length).toBe(1);
  expect(desktop.opened[0]).toBe("https://are.na/");
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("link", { name: "Your profile", exact: true }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: "Light", exact: true }).check();
  await expect
    .poll(() => desktop.appearances.at(-1))
    .toEqual({ label: "main", preference: "light", resolved: "light" });
  await page.reload();
  await expect(page.getByRole("radio", { name: "Light", exact: true })).toBeChecked();
  await expect
    .poll(() => desktop.appearances.at(-1))
    .toEqual({ label: "main", preference: "light", resolved: "light" });
  await page.getByRole("radio", { name: "System", exact: true }).check();
  await page.emulateMedia({ colorScheme: "light" });
  await expect
    .poll(() => desktop.appearances.at(-1))
    .toEqual({ label: "main", preference: "system", resolved: "light" });
  // Native cleanup can remain offline while auth sign-out clears the current account.
  let releaseCleanup!: () => void;
  desktop.stopCleanup = new Promise<void>((resolve) => {
    releaseCleanup = resolve;
  });
  const previousStops = desktop.stopped;
  try {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect.poll(() => desktop.stopped).toBeGreaterThan(previousStops);
    await expect(page).toHaveURL(/login/);
    expect(desktop.token).toBeNull();
  } finally {
    releaseCleanup();
  }
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
});

test("links in messages open in the default browser and the window stays", async ({
  page,
  request,
  context,
}) => {
  const { conversationId } = await (await request.post(apiURL + "/_test/reset")).json();
  const desktop = new DesktopHarness();
  await desktop.attach(page, "main");
  await page.goto("/login");
  await page.getByLabel("Email or username", { exact: true }).fill("alice@test.example");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
  await page.goto("/messages/" + conversationId);
  await page.getByLabel("Message", { exact: true }).fill("See https://are.na/x, or www.are.na.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const message = page.getByRole("listitem").last(),
    thread = page.url();
  // The sent message replaces the pending one, which would take focus with it.
  await expect(message.getByRole("link")).toHaveCount(2);
  await expect(page.getByText("Sending…")).toHaveCount(0);
  // A click, Enter on the message and its menu all hand the link to the browser.
  await message.getByRole("link", { name: "https://are.na/x", exact: true }).click();
  await expect.poll(() => desktop.opened).toEqual(["https://are.na/x"]);
  await message.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => desktop.opened).toHaveLength(2);
  expect(desktop.opened[1]).toBe("https://are.na/x");
  await message.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open www.are.na", exact: true }).click();
  await expect.poll(() => desktop.opened).toHaveLength(3);
  expect(desktop.opened[2]).toBe("https://www.are.na/");
  // The menu closes on its item as it does in a browser, from the keyboard too.
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(message).toBeFocused();
  await page.keyboard.press("Shift+F10");
  // Keys pressed before the menu has taken focus still reach the message.
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest("[role=menu]")))
    .toBe(true);
  await page.keyboard.press("End");
  await expect(page.getByRole("menuitem", { name: "Open www.are.na", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => desktop.opened).toHaveLength(4);
  expect(desktop.opened[3]).toBe("https://www.are.na/");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(message).toBeFocused();
  expect(page.url()).toBe(thread);
  expect(context.pages()).toHaveLength(1);
});

test("Index's Settings… menu item opens Settings in main, asking to sign in first", async ({
  page,
  request,
}) => {
  await request.post(apiURL + "/_test/reset");
  const desktop = new DesktopHarness();
  await desktop.attach(page, "main");
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await desktop.chooseSettings();
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings$/);
  await expect.poll(() => desktop.pending).toBeNull();
  await page.getByLabel("Email or username", { exact: true }).fill("alice@test.example");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
  await desktop.chooseSettings();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("button", { name: "Edit profile", exact: true })).toBeVisible();
  // Settings waits for an open modal rather than discarding what it holds.
  await page.goto("/u/alice");
  await page
    .getByRole("navigation", { name: "Lists" })
    .getByRole("button", { name: "New group", exact: true })
    .click();
  const name = page
    .getByRole("dialog", { name: "New group", exact: true })
    .getByLabel("Name", { exact: true });
  await name.fill("Half typed");
  await desktop.chooseSettings();
  await expect.poll(() => desktop.pending).toBeNull();
  await expect(page).toHaveURL(/\/u\/alice$/);
  await expect(name).toHaveValue("Half typed");
});

test("desktop restricted bearer survives interruption, verifies, and is erased after recovery revocation", async ({
  page,
  request,
  context,
}) => {
  await request.post(apiURL + "/_test/reset");
  const desktop = new DesktopHarness();
  await desktop.attach(page, "main");
  await page.goto("/login?next=%2Fu%2Fbearer_reader");
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("New bearer reader");
  await page.getByLabel("Username", { exact: true }).fill("bearer_reader");
  await page.getByLabel("Email", { exact: true }).fill("bearer_reader@example.test");
  await page.getByLabel("Password", { exact: true }).fill("bearer-reader-password");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  expect(desktop.token).toContain(".");
  const restricted = desktop.token;
  expect(await context.cookies(apiURL)).toHaveLength(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  expect(desktop.token).toBe(restricted);
  const mail = async (purpose: string) => {
    let code: string | undefined;
    await expect
      .poll(async () => {
        const messages = await (
          await request.get(apiURL + "/_test/mail?email=bearer_reader%40example.test")
        ).json();
        code = messages.findLast((m: { purpose: string }) => m.purpose === purpose)?.code;
        return !!code;
      })
      .toBe(true);
    return code!;
  };
  await page.getByLabel("Verification code").fill(await mail("verify"));
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page).toHaveURL(/\/u\/bearer_reader$/);
  await expect(page.locator(".profile-heading h1")).toHaveText("New bearer reader");
  await request.post(apiURL + "/api/auth/security/request-reset", {
    data: { email: "bearer_reader@example.test" },
  });
  await request.post(apiURL + "/api/auth/security/reset-password", {
    data: {
      email: "bearer_reader@example.test",
      code: await mail("reset"),
      newPassword: "recovered-bearer-password",
    },
  });
  // The account socket carries the revocation: without a protected read, the app erases the
  // bearer and stays on this public profile as a visitor.
  await expect(page.getByText("Sign in to follow", { exact: true })).toBeVisible();
  await expect.poll(() => desktop.token).toBeNull();
  await page.goto("/settings");
  await expect(page).toHaveURL(/login/);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
});
