import { apiURL, webURL } from "./urls";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const callback = "http://127.0.0.1:9/callback";

test.beforeEach(async ({ request }) => {
  await request.post(apiURL + "/_test/reset");
});

/** The signed-in user approves the app in the browser; the app exchanges the code. */
async function connect(page: Page, request: APIRequestContext, clientId: string, write: boolean) {
  const verifier = crypto.randomUUID() + crypto.randomUUID();
  const challenge = Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  ).toString("base64url");
  const authorize = new URL(apiURL + "/api/auth/oauth2/authorize");
  for (const [key, value] of Object.entries({
    response_type: "code",
    client_id: clientId,
    redirect_uri: callback,
    scope: "read write offline_access",
    state: "mcp-state",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: apiURL + "/mcp",
  }))
    authorize.searchParams.set(key, value);
  await page.goto(authorize.href);
  await expect(page).toHaveURL(new RegExp(`^${webURL}/connect\\?`));
  const writeAccess = page.getByRole("checkbox", { name: /Write/ });
  if (!write) await writeAccess.uncheck();
  await expect(writeAccess).toBeChecked({ checked: write });
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await page.waitForURL(`${callback}**`);
  const exchanged = await request.post(apiURL + "/api/auth/oauth2/token", {
    form: {
      grant_type: "authorization_code",
      code: new URL(page.url()).searchParams.get("code")!,
      redirect_uri: callback,
      client_id: clientId,
      code_verifier: verifier,
      resource: apiURL + "/mcp",
    },
  });
  expect(exchanged.status()).toBe(200);
  return ((await exchanged.json()) as { access_token: string }).access_token;
}

/** A JSON-RPC request to the MCP endpoint, as a 2025-era client sends it. */
async function mcp(request: APIRequestContext, token: string, method: string, params = {}) {
  const response = await request.post(apiURL + "/mcp", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
    },
    data: { jsonrpc: "2.0", id: 1, method, params },
  });
  const body = await response.text();
  // Stateless 2025-era responses arrive as a one-message event stream.
  const message = response.headers()["content-type"]?.includes("text/event-stream")
    ? body
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .at(-1)!
        .slice("data: ".length)
    : body;
  return {
    status: response.status(),
    challenge: response.headers()["www-authenticate"],
    ...(response.ok()
      ? (JSON.parse(message) as {
          result?: { tools?: { name: string }[]; structuredContent?: unknown; isError?: boolean };
          error?: { message: string };
        })
      : {}),
  };
}

test("a browser MCP client on another origin reaches /mcp and reads its sign-in challenge", async ({
  page,
}) => {
  await page.goto(webURL + "/login");
  const answer = await page.evaluate(async (url) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "initialize",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    return { status: response.status, challenge: response.headers.get("WWW-Authenticate") };
  }, apiURL + "/mcp");
  expect(answer.status).toBe(401);
  expect(answer.challenge).toContain(
    `resource_metadata="${apiURL}/.well-known/oauth-protected-resource/mcp"`,
  );
});

test("an agent reads, is refused writes until reconnected with write, and loses access on disconnect", async ({
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
  await page.route(`${callback}**`, (route) => route.fulfill({ body: "Connected" }));
  await page.goto("/login");
  await page.getByLabel("Email or username", { exact: true }).fill("alice");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");

  const reader = await connect(page, request, client_id, false);
  const tools = (await mcp(request, reader, "tools/list")).result!.tools!.map((tool) => tool.name);
  expect(tools).toContain("list_my_links");
  expect(tools).not.toContain("save_link");
  const listed = await mcp(request, reader, "tools/call", { name: "list_my_links", arguments: {} });
  expect(listed.result!.isError).toBeUndefined();
  const { items } = listed.result!.structuredContent as { items: { title: string }[] };
  expect(items.length).toBeGreaterThan(0);
  const save = {
    name: "save_link",
    arguments: { url: "https://example.com/agent", requestId: crypto.randomUUID() },
  };
  expect((await mcp(request, reader, "tools/call", save)).error?.message).toBe(
    "Tool save_link not found",
  );

  const writer = await connect(page, request, client_id, true);
  const saved = await mcp(request, writer, "tools/call", save);
  expect(saved.result!.isError).toBeUndefined();
  expect(saved.result!.structuredContent).toMatchObject({
    status: "saved",
    link: { url: "https://example.com/agent" },
  });

  await page.goto("/settings");
  const app = page.getByRole("region", { name: "Connections" }).locator(".connected-app");
  await expect(app).toContainText("Read and write");
  await app.getByRole("button", { name: "Disconnect Playwright agent" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Disconnect", exact: true })
    .click();
  await expect(app).toHaveCount(0);
  const disconnected = await mcp(request, writer, "tools/list");
  expect(disconnected.status).toBe(401);
  expect(disconnected.challenge).toContain(
    `resource_metadata="${apiURL}/.well-known/oauth-protected-resource/mcp"`,
  );
});
