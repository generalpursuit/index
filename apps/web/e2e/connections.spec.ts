import { apiURL, webURL } from "./urls";
import { test, expect } from "@playwright/test";

const callback = "http://127.0.0.1:9/callback";

test.beforeEach(async ({ request }) => {
  await request.post(apiURL + "/_test/reset");
});

test("an MCP client connects through sign-in and consent, then is disconnected", async ({
  page,
  request,
}) => {
  const registered = await request.post(apiURL + "/api/auth/oauth2/register", {
    data: {
      client_name: "Playwright agent",
      redirect_uris: [callback],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
  });
  expect(registered.status()).toBe(201);
  const { client_id } = (await registered.json()) as { client_id: string };
  // The app's own callback; the code arrives here.
  await page.route(`${callback}**`, (route) => route.fulfill({ body: "Connected" }));

  // The agent opens the API's authorize endpoint; signed out, it lands on the web origin.
  const authorize = new URL(apiURL + "/api/auth/oauth2/authorize");
  for (const [key, value] of Object.entries({
    response_type: "code",
    client_id,
    redirect_uri: callback,
    scope: "read write offline_access",
    // Router-shaped values that must reach the API exactly as signed.
    state: "12345678901234567890",
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
    resource: apiURL + "/mcp",
  }))
    authorize.searchParams.set(key, value);
  await page.goto(authorize.href);
  await expect(page).toHaveURL(new RegExp(`^${webURL}/login\\?next=`));
  await page.getByLabel("Email or username", { exact: true }).fill("alice");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`^${webURL}/connect\\?`));
  await expect(
    page.getByRole("heading", { name: "Playwright agent wants to use your Index account" }),
  ).toBeVisible();
  await expect(page.getByText("Signed in as alice")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Read (always included)" })).toBeChecked();
  const write = page.getByRole("checkbox", { name: /Write/ });
  await expect(write).toBeChecked();
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await page.waitForURL(`${callback}**`);
  const returned = new URL(page.url());
  expect(returned.searchParams.get("code")).toBeTruthy();
  expect(returned.searchParams.get("state")).toBe("12345678901234567890");
  expect(returned.searchParams.get("iss")).toBe(apiURL + "/api/auth");

  await page.goto("/settings");
  const connections = page.getByRole("region", { name: "Connections" });
  await expect(connections.getByText(apiURL + "/mcp", { exact: true })).toBeVisible();
  const app = connections.locator(".connected-app");
  await expect(app).toHaveCount(1);
  await expect(app).toContainText("Playwright agent");
  await expect(app).toContainText("Read and write");
  await app.getByRole("button", { name: "Disconnect Playwright agent" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Disconnect", exact: true })
    .click();
  await expect(app).toHaveCount(0);
  await expect(connections.getByText("No apps are connected.")).toBeVisible();

  // Already signed in, the agent's next request goes straight to consent; read-only this time.
  await page.goto(authorize.href);
  await expect(page).toHaveURL(new RegExp(`^${webURL}/connect\\?`));
  await page.getByRole("checkbox", { name: /Write/ }).uncheck();
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await page.waitForURL(`${callback}**`);
  expect(new URL(page.url()).searchParams.get("state")).toBe("12345678901234567890");
  await page.goto("/settings");
  await expect(app).toContainText("Read only");
});

test("an app that forces a fresh login gets one, even from a signed-in browser", async ({
  page,
  request,
}) => {
  const registered = await request.post(apiURL + "/api/auth/oauth2/register", {
    data: {
      client_name: "Strict agent",
      redirect_uris: [callback],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
  });
  const { client_id } = (await registered.json()) as { client_id: string };
  await page.route(`${callback}**`, (route) => route.fulfill({ body: "Connected" }));
  const signIn = async () => {
    await page.getByLabel("Email or username", { exact: true }).fill("alice");
    await page.getByLabel("Password", { exact: true }).fill("test-password-123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  };
  await page.goto("/login");
  await signIn();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");

  const authorize = new URL(apiURL + "/api/auth/oauth2/authorize");
  for (const [key, value] of Object.entries({
    response_type: "code",
    client_id,
    redirect_uri: callback,
    scope: "read offline_access",
    state: "fresh-login",
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
    resource: apiURL + "/mcp",
    prompt: "login",
  }))
    authorize.searchParams.set(key, value);
  await page.goto(authorize.href);
  await expect(page).toHaveURL(new RegExp(`^${webURL}/login\\?oauth=`));
  await expect(page.getByText("asks you to sign in again")).toBeVisible();
  await signIn();

  await expect(
    page.getByRole("heading", { name: "Strict agent wants to use your Index account" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await page.waitForURL(`${callback}**`);
  const returned = new URL(page.url());
  expect(returned.searchParams.get("code")).toBeTruthy();
  expect(returned.searchParams.get("state")).toBe("fresh-login");
});
