import { apiURL } from "./urls";
import { test, expect } from "@playwright/test";

test("desktop bridge uses bearer auth, restores login, opens websites and erases logout", async ({
  page,
  request,
  context,
}) => {
  await request.post(apiURL + "/_test/reset");
  let token: string | null = null;
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
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/login/);
  expect(token).toBeNull();
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
});
