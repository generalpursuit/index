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
  await page.exposeBinding(
    "nativeCommand",
    async (_source, command: string, args?: { token?: string | null; url?: string }) => {
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
  await page.goto("/login");
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
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/login/);
  expect(token).toBeNull();
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
});
