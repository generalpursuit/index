import { apiURL } from "./urls";
import { test, expect } from "@playwright/test";

test("desktop bridge uses bearer auth, restores login, opens websites and erases logout", async ({
  page,
  request,
  context,
}) => {
  await request.post(apiURL + "/_test/reset");
  let token: string | null = null;
  let stopCleanup: Promise<void> | undefined;
  let stopped = 0;
  const opened: string[] = [];
  const appearances: { preference?: string; resolved?: string }[] = [];
  await page.exposeBinding(
    "nativeCommand",
    async (
      _source,
      command: string,
      args?: { token?: string | null; url?: string; preference?: string; resolved?: string },
    ) => {
      if (command === "set_appearance") {
        appearances.push({ preference: args?.preference, resolved: args?.resolved });
        return;
      }
      if (command === "notification_status")
        return { permission: "default", registered: false, supported: true };
      if (command === "notification_active") return;
      if (command === "notification_stop") {
        stopped++;
        return stopCleanup;
      }
      if (command === "notification_take_click") return null;
      if (command === "session_read") return token;
      if (command === "session_write") {
        token = args?.token ?? null;
        return;
      }
      if (command === "open_website") {
        opened.push(args?.url ?? "");
        return;
      }
      throw new Error("Unexpected native command " + command);
    },
  );
  await page.addInitScript(() => {
    Object.assign(window, {
      __TAURI_INTERNALS__: {},
      __TAURI__: {
        core: {
          invoke: (command: string, args: unknown) => (window as any).nativeCommand(command, args),
        },
      },
    });
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/login");
  await expect.poll(() => appearances.at(-1)).toEqual({ preference: "system", resolved: "dark" });
  await page.getByLabel("Email or username", { exact: true }).fill("alice@test.example");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
  expect(token).toContain(".");
  expect(await context.cookies(apiURL + "")).toHaveLength(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
  // The domain in a row opens the website directly.
  await page.getByRole("link", { name: "are.na", exact: true }).click();
  await expect.poll(() => opened.length).toBe(1);
  expect(opened[0]).toBe("https://are.na/");
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("link", { name: "Your profile", exact: true }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: "Light", exact: true }).check();
  await expect.poll(() => appearances.at(-1)).toEqual({ preference: "light", resolved: "light" });
  await page.reload();
  await expect(page.getByRole("radio", { name: "Light", exact: true })).toBeChecked();
  await expect.poll(() => appearances.at(-1)).toEqual({ preference: "light", resolved: "light" });
  await page.getByRole("radio", { name: "System", exact: true }).check();
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => appearances.at(-1)).toEqual({ preference: "system", resolved: "light" });
  // Native cleanup can remain offline while auth sign-out clears the current account.
  let releaseCleanup!: () => void;
  stopCleanup = new Promise<void>((resolve) => {
    releaseCleanup = resolve;
  });
  const previousStops = stopped;
  try {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect.poll(() => stopped).toBeGreaterThan(previousStops);
    await expect(page).toHaveURL(/login/);
    expect(token).toBeNull();
  } finally {
    releaseCleanup();
  }
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
});

test("desktop restricted bearer survives interruption, verifies, and is erased after recovery revocation", async ({
  page,
  request,
  context,
}) => {
  await request.post(apiURL + "/_test/reset");
  let token: string | null = null;
  await page.exposeBinding(
    "nativeCommand",
    async (_source, command: string, args?: { token?: string | null }) => {
      if (command === "set_appearance") return;
      if (command === "notification_status")
        return { permission: "default", registered: false, supported: true };
      if (command === "notification_active" || command === "notification_stop") return;
      if (command === "notification_take_click") return null;
      if (command === "session_read") return token;
      if (command === "session_write") {
        token = args?.token ?? null;
        return;
      }
      throw new Error("Unexpected native command " + command);
    },
  );
  await page.addInitScript(() => {
    Object.assign(window, {
      __TAURI_INTERNALS__: {},
      __TAURI__: {
        core: {
          invoke: (command: string, args: unknown) => (window as any).nativeCommand(command, args),
        },
      },
    });
  });
  await page.goto("/login?next=%2Fu%2Fbearer_reader");
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("New bearer reader");
  await page.getByLabel("Username", { exact: true }).fill("bearer_reader");
  await page.getByLabel("Email", { exact: true }).fill("bearer_reader@example.test");
  await page.getByLabel("Password", { exact: true }).fill("bearer-reader-password");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  expect(token).toContain(".");
  const restricted = token;
  expect(await context.cookies(apiURL)).toHaveLength(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  expect(token).toBe(restricted);
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
  await page.getByRole("link", { name: "Settings", exact: true }).first().click();
  await expect(page).toHaveURL(/login/);
  await expect.poll(() => token).toBeNull();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
});
