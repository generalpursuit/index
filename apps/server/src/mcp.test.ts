import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { sessionCaller } from "@index/api/context";
import { createTestDatabase } from "@index/api/testing/database";
import { createAuth, verifyMcpAccess } from "@index/auth";
import type { SecurityEmail } from "@index/auth/delivery";
import { notificationEvents } from "@index/db/schema/notifications";
import { createApp } from "./app";

const api = "https://api.example.com";
const web = "https://web.example.com";
const resource = `${api}/mcp`;
const metadata = `${api}/.well-known/oauth-protected-resource/mcp`;
const callback = "http://127.0.0.1:7777/callback";
const password = "secure-test-password-123";

type ToolResult = {
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

describe("MCP endpoint", () => {
  let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: ReturnType<typeof createApp>;
  let mail: SecurityEmail[];
  let dispatched: string[];
  before(async () => {
    fixture = await createTestDatabase();
  });
  beforeEach(async () => {
    await fixture.reset();
    mail = [];
    dispatched = [];
    const auth = () =>
      createAuth(
        {
          BETTER_AUTH_URL: api,
          BETTER_AUTH_SECRET: "test-only-secret-with-at-least-32-characters",
          CORS_ORIGIN: web,
        },
        fixture.db,
        [],
        { sendEmail: async (message) => void mail.push(message) },
      );
    const dispatch = async () => {
      dispatched.push("begin");
      return () => void dispatched.push("finish");
    };
    app = createApp({
      origins: [web],
      auth: async () => auth(),
      createContext: async (request) => ({
        ...fixture.context(null),
        caller: sessionCaller(await auth().api.getSession({ headers: request.headers })),
        dispatch,
      }),
      readMedia: async () => null,
      mcp: {
        apiURL: api,
        createContext: async (request) => {
          const access = await verifyMcpAccess(fixture.db, api, request);
          return (
            access && { ...fixture.context(null), caller: { kind: "agent", ...access }, dispatch }
          );
        },
      },
    });
  });
  after(async () => {
    await fixture?.close();
  });

  const execution = { waitUntil() {}, passThroughOnException() {}, props: {} };
  const request = (path: string, init?: RequestInit) =>
    app.fetch(new Request(new URL(path, api), init), {}, execution);
  const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  /** A verified account signed in on the web, with its session cookie and signed token. */
  async function account(username: string) {
    const email = `${username}@example.test`;
    const signedUp = await json(
      "/api/auth/sign-up/email",
      { name: username, username, email, password },
      { Origin: web },
    );
    assert.equal(signedUp.status, 200, await signedUp.clone().text());
    const token = signedUp.headers.get("set-auth-token")!;
    const cookie = `__Secure-better-auth.session_token=${token}`;
    const code = mail.findLast((message) => message.to === email)!.code;
    const verified = await json(
      "/api/auth/security/verify-email",
      { code },
      { Cookie: cookie, Origin: web },
    );
    assert.equal(verified.status, 200);
    const { user } = (await signedUp.json()) as { user: { id: string } };
    return { id: user.id, cookie, token };
  }

  /** Registers an app and connects it to the account with `scope`, returning its tokens. */
  async function connect(cookie: string, scope: "read" | "read write") {
    const registered = await json("/api/auth/oauth2/register", {
      client_name: "Agent",
      redirect_uris: [callback],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    assert.equal(registered.status, 201, await registered.clone().text());
    const { client_id } = (await registered.json()) as { client_id: string };
    const verifier = crypto.randomUUID() + crypto.randomUUID();
    const challenge = Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ).toString("base64url");
    const authorize = new URL("/api/auth/oauth2/authorize", api);
    for (const [key, value] of Object.entries({
      response_type: "code",
      client_id,
      redirect_uri: callback,
      scope,
      state: "state",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource,
    }))
      authorize.searchParams.set(key, value);
    const page = await request(authorize.pathname + authorize.search, {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
    assert.equal(page.status, 302, await page.clone().text());
    const approved = await json(
      "/api/auth/oauth2/consent",
      { accept: true, scope, oauth_query: new URL(page.headers.get("location")!).search.slice(1) },
      { Cookie: cookie, Origin: web },
    );
    assert.equal(approved.status, 200, await approved.clone().text());
    const code = new URL(((await approved.json()) as { url: string }).url).searchParams.get(
      "code",
    )!;
    const exchanged = await request("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: callback,
        client_id,
        code_verifier: verifier,
        resource,
      }),
    });
    assert.equal(exchanged.status, 200, await exchanged.clone().text());
    const { access_token } = (await exchanged.json()) as { access_token: string };
    return { clientId: client_id, token: access_token };
  }

  /** A raw JSON-RPC request to `/mcp`, as a 2025-era client sends it. */
  function mcp(token: string | null, method: string, params: object = {}, headers = {}) {
    return request("/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-06-18",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  }

  /** The JSON-RPC response, whether it arrived as JSON or as an event stream. */
  async function reply(response: Response) {
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.text();
    const message = response.headers.get("content-type")?.includes("text/event-stream")
      ? body
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice("data: ".length))
          .at(-1)!
      : body;
    return JSON.parse(message) as {
      result?: Record<string, unknown>;
      error?: { code: number; message: string };
    };
  }

  const toolNames = async (token: string) =>
    ((await reply(await mcp(token, "tools/list"))).result!.tools as { name: string }[])
      .map((tool) => tool.name)
      .sort();

  async function call(token: string, name: string, args: object) {
    return (await reply(await mcp(token, "tools/call", { name, arguments: args })))
      .result as ToolResult;
  }

  it("initializes with each 2025-era protocol version", async () => {
    const alice = await account("ada");
    const { token } = await connect(alice.cookie, "read");
    for (const version of ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]) {
      const { result } = await reply(
        await mcp(
          token,
          "initialize",
          {
            protocolVersion: version,
            capabilities: {},
            clientInfo: { name: "test", version: "1.0.0" },
          },
          { "MCP-Protocol-Version": version },
        ),
      );
      assert.equal(result!.protocolVersion, version);
      assert.deepEqual(result!.serverInfo, { name: "Index", version: "1.0.0" });
      assert.ok((result!.capabilities as Record<string, unknown>).tools);
    }
  });

  it("lists only the tools a connection's permissions allow", async () => {
    const alice = await account("ada");
    const read = await connect(alice.cookie, "read");
    const readTools = await toolNames(read.token);
    assert.ok(readTools.includes("list_my_links"));
    assert.ok(readTools.includes("search_links"));
    assert.equal(readTools.length, 11);
    for (const write of ["save_link", "forward_link", "post_comment"])
      assert.ok(!readTools.includes(write), `${write} is hidden from a read-only connection`);

    const write = await connect(alice.cookie, "read write");
    assert.deepEqual(
      await toolNames(write.token),
      [...readTools, "forward_link", "post_comment", "save_link"].sort(),
    );
    const { result } = await reply(await mcp(write.token, "tools/list"));
    const tools = result!.tools as {
      name: string;
      description: string;
      annotations?: { readOnlyHint?: boolean };
    }[];
    const save = tools.find((tool) => tool.name === "save_link")!;
    assert.equal(save.annotations?.readOnlyHint, false);
    assert.match(save.description, /Saves a web address/);
    assert.equal(
      tools.find((tool) => tool.name === "list_my_links")!.annotations?.readOnlyHint,
      true,
    );
  });

  it("serves the 2026-07-28 protocol too", async () => {
    const alice = await account("ada");
    const { token } = await connect(alice.cookie, "read");
    const response = await request("/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/list",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": { name: "test", version: "1.0.0" },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });
    const { result } = await reply(response);
    assert.equal((result!.tools as unknown[]).length, 11);
  });

  it("calls read and write tools as the connection's account", async () => {
    const alice = await account("ada");
    const { token } = await connect(alice.cookie, "read write");
    const saved = await call(token, "save_link", {
      url: "https://example.com/article",
      requestId: crypto.randomUUID(),
    });
    assert.equal(saved.isError, undefined, saved.content[0]!.text);
    const link = (
      saved.structuredContent as { status: string; link: { id: string; ownerId: string } }
    ).link;
    assert.equal(link.ownerId, alice.id);
    assert.deepEqual(dispatched, ["begin", "finish"]);

    const listed = await call(token, "list_my_links", {});
    assert.equal(listed.isError, undefined, listed.content[0]!.text);
    const { items } = listed.structuredContent as { items: { id: string }[] };
    assert.deepEqual(
      items.map((item) => item.id),
      [link.id],
    );
    assert.deepEqual(JSON.parse(listed.content[0]!.text), listed.structuredContent);
  });

  it("refuses a write tool to a read-only connection", async () => {
    const alice = await account("ada");
    const { token } = await connect(alice.cookie, "read");
    const { error } = await reply(
      await mcp(token, "tools/call", {
        name: "save_link",
        arguments: { url: "https://example.com", requestId: crypto.randomUUID() },
      }),
    );
    assert.deepEqual(error, { code: -32602, message: "Tool save_link not found" });
    assert.deepEqual(dispatched, []);
  });

  it("reports an API error as a tool error carrying its message", async () => {
    const alice = await account("ada");
    const { token } = await connect(alice.cookie, "read");
    const missing = await call(token, "get_link", { id: crypto.randomUUID() });
    assert.equal(missing.isError, true);
    const error = JSON.parse(missing.content[0]!.text) as { code: string; message: string };
    assert.equal(error.code, "NOT_FOUND");
    assert.equal(error.message, "Link not found.");
  });

  it("never reaches a procedure that isn't marked as a tool", async () => {
    const alice = await account("ada");
    const { token } = await connect(alice.cookie, "read write");
    for (const name of ["links_delete", "links.delete", "delete", "healthCheck", "live_ticket"]) {
      const { error } = await reply(await mcp(token, "tools/call", { name, arguments: {} }));
      assert.deepEqual(error, { code: -32602, message: `Tool ${name} not found` });
    }
  });

  it("shows an agent only what its account can see", async () => {
    const alice = await account("ada");
    const bob = await account("ben");
    const bobRPC = (path: string, body: unknown) =>
      json(`/api/v1${path}`, body, { Authorization: `Bearer ${bob.token}` });
    const group = (await (
      await bobRPC("/groups", { name: "Locked", visibility: "private" })
    ).json()) as { id: string };
    const hidden = (await (
      await bobRPC("/links", { url: "https://example.com/hidden", groupId: group.id })
    ).json()) as { id: string };
    const shown = (await (await bobRPC("/links", { url: "https://example.com/shown" })).json()) as {
      id: string;
    };

    const { token } = await connect(alice.cookie, "read");
    const missing = await call(token, "get_link", { id: hidden.id });
    assert.equal(missing.isError, true);
    assert.match(missing.content[0]!.text, /NOT_FOUND/);
    const listed = await call(token, "list_person_links", { userId: bob.id });
    assert.equal(listed.isError, undefined, listed.content[0]!.text);
    assert.deepEqual(
      (listed.structuredContent as { items: { id: string }[] }).items.map((item) => item.id),
      [shown.id],
    );
  });

  it("forwards a link with the notification and dispatch of a normal send", async () => {
    const alice = await account("ada");
    const bob = await account("ben");
    const followed = await json(
      `/api/v1/profiles/${bob.id}/follow`,
      {},
      {
        Authorization: `Bearer ${alice.token}`,
      },
    );
    assert.ok(followed.ok, await followed.clone().text());
    const { token } = await connect(alice.cookie, "read write");
    const saved = await call(token, "save_link", {
      url: "https://example.com",
      requestId: crypto.randomUUID(),
    });
    const { link } = saved.structuredContent as { link: { id: string } };
    dispatched = [];

    const forwarded = await call(token, "forward_link", {
      linkId: link.id,
      recipientId: bob.id,
      note: "Look",
      clientId: crypto.randomUUID(),
    });
    assert.equal(forwarded.isError, undefined, forwarded.content[0]!.text);
    const message = forwarded.structuredContent as { id: string; body: string };
    assert.equal(message.body, "Look");
    assert.deepEqual(dispatched, ["begin", "finish"]);
    const events = await fixture.db.select().from(notificationEvents);
    assert.deepEqual(
      events
        .filter((event) => event.category === "message")
        .map((event) => [event.recipientId, event.messageId]),
      [[bob.id, message.id]],
    );
  });

  it("answers 401 with the protected-resource challenge without a valid token", async () => {
    const alice = await account("ada");
    const { clientId, token } = await connect(alice.cookie, "read");
    const revoked = await json(
      "/api/auth/connections/revoke",
      { clientId },
      { Cookie: alice.cookie, Origin: web },
    );
    assert.equal(revoked.status, 200, await revoked.clone().text());
    for (const response of [
      await mcp(null, "tools/list"),
      await mcp("index_at_unknown", "tools/list"),
      await mcp(token, "tools/list"),
      // Neither the web session's cookie nor its signed token authorizes an agent.
      await mcp(null, "tools/list", { Cookie: alice.cookie }),
      await mcp(alice.token, "tools/list"),
      await request("/mcp", { headers: { Authorization: `Bearer ${token}` } }),
    ]) {
      assert.equal(response.status, 401);
      assert.match(
        response.headers.get("www-authenticate")!,
        new RegExp(`^Bearer .*resource_metadata="${metadata}"`),
      );
    }
  });

  it("accepts OAuth tokens on /mcp only", async () => {
    const alice = await account("ada");
    const { token } = await connect(alice.cookie, "read write");
    const bearer = { Authorization: `Bearer ${token}` };
    const rest = await request("/api/v1/links", { headers: bearer });
    assert.equal(rest.status, 401);
    const rpc = await json("/rpc/links/listMine", { json: {} }, bearer);
    assert.equal(rpc.status, 401);
    const session = await request("/api/auth/get-session", { headers: bearer });
    assert.equal(await session.json(), null);
    const connections = await request("/api/auth/connections", { headers: bearer });
    assert.equal(connections.status, 401);
    assert.equal((await mcp(token, "tools/list")).status, 200);
  });

  it("allows any origin without credentials and exposes the challenge", async () => {
    const preflight = await request("/mcp", {
      method: "OPTIONS",
      headers: {
        Origin: "https://agent.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type,mcp-protocol-version",
      },
    });
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
    assert.equal(preflight.headers.get("access-control-allow-credentials"), null);
    assert.match(preflight.headers.get("access-control-allow-headers")!, /MCP-Protocol-Version/);
    const denied = await mcp(null, "tools/list", { Origin: "https://agent.example" });
    assert.equal(denied.headers.get("access-control-allow-origin"), "*");
    assert.match(denied.headers.get("access-control-expose-headers")!, /WWW-Authenticate/);
  });
});
