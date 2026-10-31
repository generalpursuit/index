import { test, expect, type APIRequestContext } from "@playwright/test";
import { apiURL } from "./urls";
const password = "auth-browser-password-123";
async function signIn(page: import("@playwright/test").Page, identifier = "alice") {
  await page.getByLabel("Email or username", { exact: true }).fill(identifier);
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
}
async function code(request: APIRequestContext, email: string, purpose = "verify") {
  let captured: string | undefined;
  await expect
    .poll(async () => {
      const messages = await (
        await request.get(`${apiURL}/_test/mail?email=${encodeURIComponent(email)}`)
      ).json();
      captured = messages.findLast(
        (message: { purpose: string }) => message.purpose === purpose,
      )?.code;
      return captured !== undefined;
    })
    .toBe(true);
  return captured!;
}
test.beforeEach(async ({ request }) => {
  await request.post(apiURL + "/_test/reset");
});
test("an existing unverified account receives a code on password sign-in", async ({
  page,
  request,
}) => {
  // The account exists before this browser session and has never received a code.
  await request.post(apiURL + "/_test/email-failure", { data: { enabled: true } });
  const created = await request.post(apiURL + "/api/auth/sign-up/email", {
    data: {
      name: "Existing reader",
      username: "existing_reader",
      email: "existing@example.test",
      password,
    },
  });
  expect(created.ok()).toBe(true);
  await request.post(apiURL + "/_test/email-failure", { data: { enabled: false } });
  await request.post(apiURL + "/_test/auth-clock");
  await page.goto("/login?next=%2Fsettings");
  await page.getByLabel("Email or username", { exact: true }).fill("existing@example.test");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  await expect(page.getByText(/Enter the six-digit code sent to/)).toBeVisible();
  const sent = await code(request, "existing@example.test");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  const mail = await (
    await request.get(apiURL + "/_test/mail?email=existing%40example.test")
  ).json();
  expect(mail).toHaveLength(1);
  await page.getByLabel("Verification code").fill(sent);
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page).toHaveURL(/settings/);
});
test("a restricted session without a challenge offers Send code without claiming delivery", async ({
  page,
  request,
}) => {
  const created = await request.post(apiURL + "/api/auth/sign-up/email", {
    data: {
      name: "Returning reader",
      username: "returning_reader",
      email: "returning@example.test",
      password,
    },
  });
  expect(created.ok()).toBe(true);
  // A new login during the signup send cooldown cannot reuse its session-bound code.
  await page.goto("/login");
  await page.getByLabel("Email or username", { exact: true }).fill("returning_reader");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Request a code to verify this address.")).toBeVisible();
  await expect(page.getByText(/Enter the six-digit code sent to/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send code", exact: true })).toBeVisible();
  await request.post(apiURL + "/_test/auth-clock");
  await page.reload();
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await expect(page.getByText(/Enter the six-digit code sent to/)).toBeVisible();
  await page.getByLabel("Verification code").fill(await code(request, "returning@example.test"));
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
});
test("signup stays restricted through reload, verifies, and changes password and email", async ({
  page,
  request,
}) => {
  await page.goto("/login?next=%2Fsettings");
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("New reader");
  await page.getByLabel("Username", { exact: true }).fill("new_reader");
  await page.getByLabel("Email", { exact: true }).fill("new_reader@example.test");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  await expect(page.getByText("new_reader@example.test", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  await page.getByLabel("Verification code").fill(await code(request, "new_reader@example.test"));
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page).toHaveURL(/settings/);
  await page.getByRole("button", { name: "Change password", exact: true }).click();
  await page.getByLabel("Current password", { exact: true }).fill(password);
  await page.getByLabel("New password", { exact: true }).fill("changed-browser-password");
  await page.getByLabel("Confirm new password", { exact: true }).fill("changed-browser-password");
  await page.getByRole("button", { name: "Save password", exact: true }).click();
  await expect(
    page.getByText("Password changed. Other sessions have been signed out."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Change email", exact: true }).click();
  await page.getByLabel("Current password", { exact: true }).fill("changed-browser-password");
  await page.getByLabel("New email", { exact: true }).fill("changed_reader@example.test");
  await page.getByRole("button", { name: "Send email change code", exact: true }).click();
  await page
    .getByLabel("Email change code")
    .fill(await code(request, "changed_reader@example.test", "change-email"));
  await page.getByRole("button", { name: "Confirm new email", exact: true }).click();
  await expect(page.getByText("Email changed. Other sessions have been signed out.")).toBeVisible();
});
test("forgot-password gives a generic response and signs in only with the new password", async ({
  page,
  request,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByLabel("Recovery email").fill("alice@test.example");
  await page.getByRole("button", { name: "Send recovery code", exact: true }).click();
  await expect(page.getByText(/If an account uses this address/)).toBeVisible();
  await page.getByLabel("Recovery code").fill(await code(request, "alice@test.example", "reset"));
  await page.getByLabel("New password", { exact: true }).fill("recovered-browser-password");
  await page.getByLabel("Confirm new password", { exact: true }).fill("recovered-browser-password");
  await page.getByRole("button", { name: "Reset password", exact: true }).click();
  await expect(page.getByText(/Password reset. Sign in/)).toBeVisible();
  await page.getByRole("button", { name: "Back to sign in" }).click();
  await page.getByLabel("Email or username", { exact: true }).fill("alice");
  await page.getByLabel("Password", { exact: true }).fill("recovered-browser-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
});
test("failed delivery retains signup, permits correction after cooldown and rejects a wrong code", async ({
  page,
  request,
}) => {
  await request.post(apiURL + "/_test/email-failure", { data: { enabled: true } });
  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Correction");
  await page.getByLabel("Username", { exact: true }).fill("correction");
  await page.getByLabel("Email", { exact: true }).fill("mistake@example.test");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByText(/We couldn’t send the email/)).toBeVisible();
  await request.post(apiURL + "/_test/email-failure", { data: { enabled: false } });
  await request.post(apiURL + "/_test/auth-clock");
  await page.reload();
  await page.getByRole("button", { name: "Correct email address" }).click();
  await page.getByLabel("Correct email", { exact: true }).fill("correct@example.test");
  await page.getByLabel("Signup password").fill(password);
  await page.getByRole("button", { name: "Send to corrected address" }).click();
  const correct = await code(request, "correct@example.test");
  await page.getByLabel("Verification code").fill(correct === "000000" ? "111111" : "000000");
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("incorrect, expired, or already used");
  await page.getByLabel("Verification code").fill(correct);
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
});

test("successful sign-out clears the visible identity even when session revalidation fails", async ({
  page,
}) => {
  await page.goto("/login");
  await signIn(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.locator(".settings-identity strong")).toHaveText("Alice");
  await page.route("**/api/auth/get-session**", (route) => route.abort("failed"));
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/login/);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Your profile", exact: true })).toHaveCount(0);
  await expect(page.locator(".settings-identity")).toHaveCount(0);
});

test("switching accounts discards a draft and a pending old mutation response", async ({
  page,
  request,
}) => {
  const fixture = await (await request.get(apiURL + "/_test/fixture")).json();
  await page.goto("/login");
  await signIn(page);
  await page.getByRole("link", { name: "Messages", exact: true }).click();
  await page.locator(`a[href$="${fixture.conversationShortId}"]`).first().click();
  await page.getByLabel("Message", { exact: true }).fill("Alice private unsent draft");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route("**/rpc/v1/profiles/update", async (route) => {
    const response = await route.fetch();
    started();
    await held;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit profile" });
  await editor.getByLabel("Name", { exact: true }).fill("Alice pending response");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await pending;
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/login/);
  await signIn(page, "bob");
  release();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.locator(".settings-identity strong")).toHaveText("Bob");
  await page.getByRole("link", { name: "Messages", exact: true }).click();
  await page.locator(`a[href$="${fixture.conversationShortId}"]`).first().click();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("");
  await expect(page.getByText("Alice private unsent draft")).toHaveCount(0);
});

test("a cookie session revoked by recovery leaves the app on its next protected read", async ({
  page,
  request,
}) => {
  // A socket that never delivers the revocation hint; the read must still end the session.
  await page.routeWebSocket(/\/live\//, () => {});
  await page.goto("/login");
  await signIn(page);
  await request.post(apiURL + "/api/auth/security/request-reset", {
    data: { email: "alice@test.example" },
  });
  await request.post(apiURL + "/api/auth/security/reset-password", {
    data: {
      email: "alice@test.example",
      code: await code(request, "alice@test.example", "reset"),
      newPassword: "reset-revokes-browser-password",
    },
  });
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/login/);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.locator(".settings-identity")).toHaveCount(0);
});
