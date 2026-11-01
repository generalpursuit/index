import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createTestDatabase } from "@index/api/testing/database";
import { createAuth, verifyMcpAccess } from "@index/auth";
import type { SecurityEmail } from "@index/auth/delivery";
import { createApp } from "./app";

const api = "https://api.example.com";
const web = "https://web.example.com";
const resource = `${api}/mcp`;
const callback = "http://127.0.0.1:7777/callback";
const password = "secure-test-password-123";

describe("MCP client authorization", () => {
  let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: ReturnType<typeof createApp>;
  let mail: SecurityEmail[];
  /** As in deployed stages; local Workers leave metadata documents off. */
  let clientMetadataDocuments: string | undefined;
  before(async () => {
    fixture = await createTestDatabase();
  });
  beforeEach(async () => {
    await fixture.reset();
    mail = [];
    clientMetadataDocuments = "true";
    const auth = () =>
      createAuth(
        {
          BETTER_AUTH_URL: api,
          BETTER_AUTH_SECRET: "test-only-secret-with-at-least-32-characters",
          CORS_ORIGIN: web,
          CLIENT_METADATA_DOCUMENTS_ENABLED: clientMetadataDocuments,
        },
        fixture.db,
        [],
        { sendEmail: async (message) => void mail.push(message) },
      );
    app = createApp({
      origins: [web],
      auth: async () => auth(),
      createContext: async () => fixture.context(null),
      readMedia: async () => null,
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
  const form = (path: string, body: Record<string, string>, origin = "https://agent.example") =>
    request(path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin },
      body: new URLSearchParams(body),
    });

  /** A signed-in account, as the browser's session cookie on the API origin. */
  async function account(username: string, verified = true) {
    const email = `${username}@example.test`;
    const signedUp = await json(
      "/api/auth/sign-up/email",
      { name: username, username, email, password },
      { Origin: web },
    );
    assert.equal(signedUp.status, 200, await signedUp.clone().text());
    const token = signedUp.headers.get("set-auth-token")!;
    const cookie = `__Secure-better-auth.session_token=${token}`;
    if (verified) {
      const code = mail.findLast((message) => message.to === email)!.code;
      const proof = await json(
        "/api/auth/security/verify-email",
        { code },
        { Cookie: cookie, Origin: web },
      );
      assert.equal(proof.status, 200);
    }
    const { user } = (await signedUp.json()) as { user: { id: string } };
    return { id: user.id, cookie };
  }

  async function register(metadata: Record<string, unknown> = {}) {
    const response = await json(
      "/api/auth/oauth2/register",
      {
        client_name: "Agent",
        redirect_uris: [callback],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        ...metadata,
      },
      { Origin: "https://agent.example" },
    );
    assert.equal(response.status, 201, await response.clone().text());
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    return ((await response.json()) as { client_id: string }).client_id;
  }

  async function pkce() {
    const verifier = crypto.randomUUID() + crypto.randomUUID();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return { verifier, challenge: Buffer.from(digest).toString("base64url") };
  }

  function authorizeURL(clientId: string, challenge: string, params: Record<string, string> = {}) {
    const url = new URL("/api/auth/oauth2/authorize", api);
    for (const [key, value] of Object.entries({
      response_type: "code",
      client_id: clientId,
      redirect_uri: callback,
      scope: "read write offline_access",
      state: "agent-state",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource,
      ...params,
    }))
      url.searchParams.set(key, value);
    return url;
  }

  /** The browser's top-level navigation to the authorize endpoint, landing on the web page. */
  async function authorize(url: URL, cookie?: string) {
    const response = await request(url.pathname + url.search, {
      headers: cookie ? { Cookie: cookie } : {},
      redirect: "manual",
    });
    assert.equal(response.status, 302, await response.clone().text());
    return new URL(response.headers.get("location")!);
  }

  async function consent(page: URL, cookie: string, scope?: string, accept = true) {
    return json(
      "/api/auth/oauth2/consent",
      { accept, scope, oauth_query: page.search.slice(1) },
      { Cookie: cookie, Origin: web },
    );
  }

  async function connect(
    clientId: string,
    cookie: string,
    scope: string,
    params: Record<string, string> = {},
  ) {
    const { verifier, challenge } = await pkce();
    const page = await authorize(authorizeURL(clientId, challenge, params), cookie);
    const approved = await consent(page, cookie, scope);
    assert.equal(approved.status, 200, await approved.clone().text());
    const redirect = new URL(((await approved.json()) as { url: string }).url);
    assert.equal(redirect.origin + redirect.pathname, callback);
    assert.equal(redirect.searchParams.get("state"), "agent-state");
    assert.equal(redirect.searchParams.get("iss"), `${api}/api/auth`);
    const exchanged = await form("/api/auth/oauth2/token", {
      grant_type: "authorization_code",
      code: redirect.searchParams.get("code")!,
      redirect_uri: callback,
      client_id: clientId,
      code_verifier: verifier,
      resource,
    });
    assert.equal(exchanged.status, 200, await exchanged.clone().text());
    assert.equal(exchanged.headers.get("access-control-allow-origin"), "*");
    return (await exchanged.json()) as {
      access_token: string;
      refresh_token: string;
      scope: string;
    };
  }

  /**
   * Pauses the first statement matching `pattern` before it reaches the database, as a slow
   * request would against a shared database, until `resume` lets it continue.
   */
  function pauseAt(pattern: RegExp) {
    const query = fixture.client.query.bind(fixture.client);
    let reached = () => {};
    let resume = () => {};
    const arrived = new Promise<void>((resolve) => (reached = resolve));
    const resumed = new Promise<void>((resolve) => (resume = resolve));
    let paused = false;
    fixture.client.query = (async (statement: string, ...rest: unknown[]) => {
      if (!paused && pattern.test(statement)) {
        paused = true;
        reached();
        await resumed;
      }
      return (query as (...args: unknown[]) => unknown)(statement, ...rest);
    }) as typeof fixture.client.query;
    return {
      arrived,
      resume() {
        fixture.client.query = query;
        resume();
      },
    };
  }

  async function exchange(clientId: string, approved: Response, verifier: string) {
    const code = new URL(((await approved.json()) as { url: string }).url).searchParams.get(
      "code",
    )!;
    const exchanged = await form("/api/auth/oauth2/token", {
      grant_type: "authorization_code",
      code,
      redirect_uri: callback,
      client_id: clientId,
      code_verifier: verifier,
      resource,
    });
    assert.equal(exchanged.status, 200, await exchanged.clone().text());
    return (await exchanged.json()) as { access_token: string; refresh_token: string };
  }

  const bearer = (token: string) =>
    new Request(resource, { method: "POST", headers: { Authorization: `Bearer ${token}` } });

  /** A valid RFC 9449 proof of a fresh P-256 key, for a POST to `url`. */
  async function dpopProof(url: string) {
    const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const { kty, crv, x, y } = (await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey;
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const header = { typ: "dpop+jwt", alg: "ES256", jwk: { kty, crv, x, y } };
    const claims = {
      jti: crypto.randomUUID(),
      htm: "POST",
      htu: url,
      iat: Math.floor(Date.now() / 1000),
    };
    const input = `${encode(header)}.${encode(claims)}`;
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keys.privateKey,
      new TextEncoder().encode(input),
    );
    return `${input}.${Buffer.from(signature).toString("base64url")}`;
  }

  it("publishes authorization-server and protected-resource discovery for the stage", async () => {
    const server = await request("/.well-known/oauth-authorization-server/api/auth", {
      headers: { Origin: "https://agent.example" },
    });
    assert.equal(server.status, 200);
    assert.equal(server.headers.get("access-control-allow-origin"), "*");
    const metadata = (await server.json()) as Record<string, unknown>;
    assert.equal(metadata.issuer, `${api}/api/auth`);
    assert.equal(metadata.authorization_endpoint, `${api}/api/auth/oauth2/authorize`);
    assert.equal(metadata.token_endpoint, `${api}/api/auth/oauth2/token`);
    assert.equal(metadata.registration_endpoint, `${api}/api/auth/oauth2/register`);
    assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
    assert.equal(metadata.client_id_metadata_document_supported, true);
    assert.equal(metadata.authorization_response_iss_parameter_supported, true);
    assert.deepEqual(metadata.scopes_supported, ["read", "write", "offline_access"]);
    // Clients that append the well-known suffix to the issuer find the same document.
    const appended = await request("/api/auth/.well-known/oauth-authorization-server");
    assert.equal(appended.headers.get("access-control-allow-origin"), "*");
    assert.deepEqual(await appended.json(), metadata);

    for (const path of [
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-protected-resource",
    ]) {
      const protectedResource = await request(path, { headers: { Origin: "https://x.example" } });
      assert.equal(protectedResource.status, 200, path);
      assert.equal(protectedResource.headers.get("access-control-allow-origin"), "*");
      const document = (await protectedResource.json()) as Record<string, unknown>;
      assert.equal(document.resource, resource);
      assert.deepEqual(document.authorization_servers, [`${api}/api/auth`]);
      assert.deepEqual(document.scopes_supported, ["read", "write"]);
    }
    const preflight = await request("/api/auth/oauth2/token", {
      method: "OPTIONS",
      headers: { Origin: "https://agent.example", "Access-Control-Request-Method": "POST" },
    });
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
    assert.equal(preflight.headers.get("access-control-allow-credentials"), null);
    // The rest of the auth API keeps its exact, credentialed origin list.
    const session = await request("/api/auth/get-session", {
      headers: { Origin: "https://agent.example" },
    });
    assert.equal(session.headers.get("access-control-allow-origin"), null);
  });

  it("connects a registered client read-only, refreshes with rotation and revokes at once", async () => {
    const person = await account("reader");
    const clientId = await register();
    const { verifier, challenge } = await pkce();

    // Signed out: the authorize endpoint sends the browser to the web connect page to sign in.
    const login = await authorize(authorizeURL(clientId, challenge));
    assert.equal(login.origin + login.pathname, `${web}/connect`);
    assert.equal(login.searchParams.get("client_id"), clientId);
    assert.ok(login.searchParams.get("sig"));

    // Signed in: consent is needed. The client asked for write; the person approves read only.
    const page = await authorize(authorizeURL(clientId, challenge), person.cookie);
    assert.equal(page.origin + page.pathname, `${web}/connect`);
    assert.equal(page.searchParams.get("scope"), "read write offline_access");
    const client = await request(`/api/auth/oauth2/public-client?client_id=${clientId}`, {
      headers: { Cookie: person.cookie, Origin: web },
    });
    assert.equal(((await client.json()) as { client_name: string }).client_name, "Agent");
    const approved = await consent(page, person.cookie, "read offline_access");
    assert.equal(approved.status, 200, await approved.clone().text());
    const redirect = new URL(((await approved.json()) as { url: string }).url);
    const code = redirect.searchParams.get("code")!;

    const tokenRequest = {
      grant_type: "authorization_code",
      code,
      redirect_uri: callback,
      client_id: clientId,
      resource,
    };
    const withoutVerifier = await form("/api/auth/oauth2/token", tokenRequest);
    assert.equal(withoutVerifier.status, 400);
    const exchanged = await form("/api/auth/oauth2/token", {
      ...tokenRequest,
      code_verifier: verifier,
    });
    assert.equal(exchanged.status, 200, await exchanged.clone().text());
    const tokens = (await exchanged.json()) as { access_token: string; refresh_token: string };
    assert.match(tokens.access_token, /^index_at_/);
    assert.match(tokens.refresh_token, /^index_rt_/);
    // Only digests are stored.
    const { rows } = await fixture.client.query<{ token: string }>(
      "SELECT token FROM oauth_access_token",
    );
    assert.ok(rows.every((row) => !tokens.access_token.includes(row.token)));

    assert.deepEqual(await verifyMcpAccess(fixture.db, api, bearer(tokens.access_token)), {
      userId: person.id,
      permissions: ["read"],
      client: { id: clientId, name: "Agent" },
    });
    // Session tokens and tokens of another stage's resource are not MCP access.
    assert.equal(
      await verifyMcpAccess(fixture.db, "https://api.other.example", tokens.access_token),
      null,
    );
    assert.equal(await verifyMcpAccess(fixture.db, api, person.cookie.split("=")[1]!), null);

    const refreshed = await form("/api/auth/oauth2/token", {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: clientId,
      resource,
    });
    assert.equal(refreshed.status, 200, await refreshed.clone().text());
    const rotated = (await refreshed.json()) as { access_token: string; refresh_token: string };
    assert.notEqual(rotated.refresh_token, tokens.refresh_token);
    assert.equal((await verifyMcpAccess(fixture.db, api, rotated.access_token))?.userId, person.id);

    const listed = await request("/api/auth/connections", {
      headers: { Cookie: person.cookie, Origin: web },
    });
    const { connections } = (await listed.json()) as {
      connections: { clientId: string; name: string; permission: string }[];
    };
    assert.deepEqual(
      connections.map(({ clientId, name, permission }) => ({ clientId, name, permission })),
      [{ clientId, name: "Agent", permission: "read" }],
    );

    const revoked = await json(
      "/api/auth/connections/revoke",
      { clientId },
      { Cookie: person.cookie, Origin: web },
    );
    assert.equal(revoked.status, 200, await revoked.clone().text());
    assert.equal(await verifyMcpAccess(fixture.db, api, rotated.access_token), null);
    const afterRevocation = await form("/api/auth/oauth2/token", {
      grant_type: "refresh_token",
      refresh_token: rotated.refresh_token,
      client_id: clientId,
      resource,
    });
    assert.equal(afterRevocation.status, 400);
    const empty = await request("/api/auth/connections", {
      headers: { Cookie: person.cookie, Origin: web },
    });
    assert.deepEqual(await empty.json(), { mcpServerURL: resource, connections: [] });
  });

  it("grants write with read, and rejects expired tokens and deleted accounts", async () => {
    const person = await account("writer");
    const clientId = await register({ client_name: "Writer agent" });
    // A client that asks for write alone still receives read with it.
    const { challenge } = await pkce();
    const page = await authorize(
      authorizeURL(clientId, challenge, { scope: "write" }),
      person.cookie,
    );
    assert.equal(page.searchParams.get("scope"), "read write");

    const tokens = await connect(clientId, person.cookie, "read write offline_access");
    assert.equal(tokens.scope, "read write offline_access");
    assert.deepEqual((await verifyMcpAccess(fixture.db, api, tokens.access_token))?.permissions, [
      "read",
      "write",
    ]);

    // An existing approval skips consent; asking again and approving read-only narrows the
    // tokens issued before.
    const again = await authorize(authorizeURL(clientId, challenge), person.cookie);
    assert.equal(again.origin + again.pathname, callback);
    const narrowed = await connect(clientId, person.cookie, "read offline_access", {
      prompt: "consent",
    });
    assert.deepEqual((await verifyMcpAccess(fixture.db, api, tokens.access_token))?.permissions, [
      "read",
    ]);
    await fixture.client.query("UPDATE oauth_access_token SET expires_at = $1", [new Date(0)]);
    assert.equal(await verifyMcpAccess(fixture.db, api, narrowed.access_token), null);

    const fresh = await form("/api/auth/oauth2/token", {
      grant_type: "refresh_token",
      refresh_token: narrowed.refresh_token,
      client_id: clientId,
      resource,
    });
    const { access_token } = (await fresh.json()) as { access_token: string };
    assert.ok(await verifyMcpAccess(fixture.db, api, access_token));
    await fixture.client.query('DELETE FROM "user" WHERE id = $1', [person.id]);
    assert.equal(await verifyMcpAccess(fixture.db, api, access_token), null);
    const { rows } = await fixture.client.query<{ count: number }>(
      `SELECT (SELECT count(*) FROM oauth_access_token) + (SELECT count(*) FROM oauth_refresh_token)
        + (SELECT count(*) FROM oauth_consent) AS count`,
    );
    assert.equal(Number(rows[0]!.count), 0);
  });

  it("keeps one approval per account and app when approvals race, so re-approving narrows all", async () => {
    const person = await account("racer");
    const clientId = await register();
    const requests = await Promise.all(
      [0, 1].map(async () => {
        const { verifier, challenge } = await pkce();
        return {
          verifier,
          page: await authorize(authorizeURL(clientId, challenge), person.cookie),
        };
      }),
    );
    // The first approval stores nothing until the second, finding no approval either, is done.
    const first = pauseAt(/^insert into "oauth_consent"/i);
    const pending = consent(requests[0]!.page, person.cookie, "read write offline_access");
    await first.arrived;
    const second = await consent(requests[1]!.page, person.cookie, "read write offline_access");
    first.resume();
    const approvals = [await pending, second];
    for (const approved of approvals) assert.equal(approved.status, 200);
    const { rows } = await fixture.client.query("SELECT id FROM oauth_consent");
    assert.equal(rows.length, 1);
    const tokens = await Promise.all(
      approvals.map((approved, index) => exchange(clientId, approved, requests[index]!.verifier)),
    );

    await connect(clientId, person.cookie, "read offline_access", { prompt: "consent" });
    for (const { access_token } of tokens)
      assert.deepEqual((await verifyMcpAccess(fixture.db, api, access_token))?.permissions, [
        "read",
      ]);
  });

  it("never revives what was issued under a deleted approval, refreshes in flight included", async () => {
    const person = await account("reconnecting");
    const clientId = await register();
    const disconnect = () =>
      json("/api/auth/connections/revoke", { clientId }, { Cookie: person.cookie, Origin: web });
    const refresh = (refresh_token: string) =>
      form("/api/auth/oauth2/token", {
        grant_type: "refresh_token",
        refresh_token,
        client_id: clientId,
        resource,
      });
    const old = await connect(clientId, person.cookie, "read write offline_access");

    // A refresh claims the old refresh token and stalls before storing its successor; the app
    // is disconnected and connected again before the refresh continues.
    const stalled = pauseAt(/^insert into "oauth_refresh_token"/i);
    const refreshing = refresh(old.refresh_token);
    await stalled.arrived;
    assert.equal((await disconnect()).status, 200);
    const current = await connect(clientId, person.cookie, "read offline_access");
    stalled.resume();
    assert.notEqual((await refreshing).status, 200);
    assert.equal(await verifyMcpAccess(fixture.db, api, old.access_token), null);
    assert.equal((await refresh(old.refresh_token)).status, 400);
    const { rows } = await fixture.client.query<{ token: string }>(
      "SELECT token FROM oauth_refresh_token WHERE revoked IS NULL",
    );
    assert.equal(rows.length, 1);
    assert.deepEqual((await verifyMcpAccess(fixture.db, api, current.access_token))?.permissions, [
      "read",
    ]);

    // A code issued before a disconnect can't be exchanged after it, nor after reconnecting.
    const { verifier, challenge } = await pkce();
    const page = await authorize(
      authorizeURL(clientId, challenge, { prompt: "consent" }),
      person.cookie,
    );
    const approved = await consent(page, person.cookie, "read write offline_access");
    assert.equal((await disconnect()).status, 200);
    await connect(clientId, person.cookie, "read offline_access");
    const code = new URL(((await approved.json()) as { url: string }).url).searchParams.get(
      "code",
    )!;
    const exchanged = await form("/api/auth/oauth2/token", {
      grant_type: "authorization_code",
      code,
      redirect_uri: callback,
      client_id: clientId,
      code_verifier: verifier,
      resource,
    });
    assert.equal(exchanged.status, 400);
    assert.equal(((await exchanged.json()) as { error: string }).error, "invalid_grant");
  });

  it("disconnects every app on password recovery, issuance in flight included, but not on sign-out", async () => {
    const person = await account("recovering");
    const email = "recovering@example.test";
    const clientId = await register();
    const second = await register({ client_name: "Second agent" });
    const refresh = (refresh_token: string) =>
      form("/api/auth/oauth2/token", {
        grant_type: "refresh_token",
        refresh_token,
        client_id: clientId,
        resource,
      });
    const connected = await connect(clientId, person.cookie, "read write offline_access");
    // Signing out ends the session's access tokens; the app stays connected and refreshes.
    await json("/api/auth/sign-out", {}, { Cookie: person.cookie, Origin: web });
    const refreshed = await refresh(connected.refresh_token);
    assert.equal(refreshed.status, 200);
    const tokens = (await refreshed.json()) as { access_token: string; refresh_token: string };
    assert.ok(await verifyMcpAccess(fixture.db, api, tokens.access_token));

    const signedIn = await json("/api/auth/sign-in/email", { email, password }, { Origin: web });
    const cookie = `__Secure-better-auth.session_token=${signedIn.headers.get("set-auth-token")}`;
    const { challenge } = await pkce();
    const pending = await authorize(
      authorizeURL(clientId, challenge, { prompt: "consent" }),
      cookie,
    );
    assert.equal((await consent(pending, cookie, "read offline_access")).status, 200);
    const secondPage = await authorize(authorizeURL(second, challenge), cookie);

    // A refresh and a second app's approval stall before storing anything while the account is
    // recovered.
    const stalledRefresh = pauseAt(/^insert into "oauth_refresh_token"/i);
    const refreshing = refresh(tokens.refresh_token);
    await stalledRefresh.arrived;
    const stalledApproval = pauseAt(/^insert into "oauth_consent"/i);
    const approving = consent(secondPage, cookie, "read write offline_access");
    await stalledApproval.arrived;
    await json("/api/auth/security/request-reset", { email }, { Origin: web });
    let reset: SecurityEmail | undefined;
    while (!(reset = mail.find((message) => message.purpose === "reset")))
      await new Promise((resolve) => setTimeout(resolve, 5));
    const recovered = await json(
      "/api/auth/security/reset-password",
      { email, code: reset.code, newPassword: "recovered-test-password" },
      { Origin: web },
    );
    assert.equal(recovered.status, 200, await recovered.clone().text());
    stalledApproval.resume();
    assert.notEqual((await approving).status, 200);
    stalledRefresh.resume();
    assert.notEqual((await refreshing).status, 200);

    assert.equal(await verifyMcpAccess(fixture.db, api, tokens.access_token), null);
    const { rows } = await fixture.client.query<{ count: number }>(
      `SELECT (SELECT count(*) FROM oauth_consent) + (SELECT count(*) FROM oauth_code_approval)
        + (SELECT count(*) FROM oauth_access_token) + (SELECT count(*) FROM oauth_refresh_token)
        + (SELECT count(*) FROM verification WHERE value LIKE '%"authorization_code"%') AS count`,
    );
    assert.equal(Number(rows[0]!.count), 0);
  });

  it("resumes a request that forces login from a fresh sign-in, even when already signed in", async () => {
    const person = await account("relogin");
    const clientId = await register();
    const { verifier, challenge } = await pkce();
    const page = await authorize(
      authorizeURL(clientId, challenge, { prompt: "login" }),
      person.cookie,
    );
    assert.equal(page.origin + page.pathname, `${web}/connect`);
    assert.equal(page.searchParams.get("prompt"), "login");
    // Approving with the older session only asks for login again: the loop the web avoids.
    const stale = await consent(page, person.cookie, "read offline_access");
    assert.equal(new URL(((await stale.json()) as { url: string }).url).pathname, "/connect");

    // Signing in again with the signed request resumes it without the login prompt.
    const signedIn = await json(
      "/api/auth/sign-in/username",
      { username: "relogin", password, oauth_query: page.search.slice(1) },
      { Origin: web },
    );
    assert.equal(signedIn.status, 200, await signedIn.clone().text());
    const cookie = `__Secure-better-auth.session_token=${signedIn.headers.get("set-auth-token")}`;
    const next = new URL(((await signedIn.json()) as { url: string }).url);
    assert.equal(next.origin + next.pathname, `${web}/connect`);
    assert.equal(next.searchParams.get("prompt"), null);
    const approved = await consent(next, cookie, "read offline_access");
    assert.equal(approved.status, 200, await approved.clone().text());
    const tokens = await exchange(clientId, approved, verifier);
    assert.equal((await verifyMcpAccess(fixture.db, api, tokens.access_token))?.userId, person.id);
  });

  it("binds tokens to the MCP resource and requires PKCE", async () => {
    const person = await account("bound");
    const clientId = await register();
    const { challenge } = await pkce();
    const other = await authorize(
      authorizeURL(clientId, challenge, { resource: `${api}/api/v1` }),
      person.cookie,
    );
    assert.equal(other.origin + other.pathname, callback);
    assert.equal(other.searchParams.get("error"), "invalid_target");

    const withoutPkce = authorizeURL(clientId, challenge);
    withoutPkce.searchParams.delete("code_challenge");
    withoutPkce.searchParams.delete("code_challenge_method");
    const refused = await authorize(withoutPkce, person.cookie);
    assert.equal(refused.searchParams.get("error"), "invalid_request");

    // A client that omits the resource indicator still gets a token bound to the MCP resource.
    const { verifier, challenge: unbound } = await pkce();
    const implicit = authorizeURL(clientId, unbound);
    implicit.searchParams.delete("resource");
    const page = await authorize(implicit, person.cookie);
    const approved = await consent(page, person.cookie);
    const code = new URL(((await approved.json()) as { url: string }).url).searchParams.get(
      "code",
    )!;
    const exchanged = await form("/api/auth/oauth2/token", {
      grant_type: "authorization_code",
      code,
      redirect_uri: callback,
      client_id: clientId,
      code_verifier: verifier,
    });
    const { access_token } = (await exchanged.json()) as { access_token: string };
    assert.ok(await verifyMcpAccess(fixture.db, api, access_token));
    await fixture.client.query("UPDATE oauth_access_token SET resources = $1", [[`${api}/other`]]);
    assert.equal(await verifyMcpAccess(fixture.db, api, access_token), null);
  });

  it("issues Bearer tokens only: DPoP is not advertised, refused when asked for and never accepted", async () => {
    for (const path of [
      "/.well-known/oauth-authorization-server/api/auth",
      "/api/auth/.well-known/oauth-authorization-server",
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      const document = (await (await request(path)).json()) as Record<string, unknown>;
      assert.deepEqual(
        Object.keys(document).filter((field) => field.startsWith("dpop_")),
        [],
        path,
      );
      assert.equal((await request(path, { method: "HEAD" })).status, 200, path);
    }

    const registration = await json("/api/auth/oauth2/register", {
      client_name: "Bound agent",
      redirect_uris: [callback],
      token_endpoint_auth_method: "none",
      dpop_bound_access_tokens: true,
    });
    assert.equal(registration.status, 400);
    assert.equal(
      ((await registration.json()) as { error: string }).error,
      "invalid_client_metadata",
    );

    const person = await account("bearer");
    const clientId = await register();
    const { verifier, challenge } = await pkce();
    const page = await authorize(authorizeURL(clientId, challenge), person.cookie);
    const approved = await consent(page, person.cookie, "read offline_access");
    const code = new URL(((await approved.json()) as { url: string }).url).searchParams.get(
      "code",
    )!;
    const tokenEndpoint = `${api}/api/auth/oauth2/token`;
    const bound = await request("/api/auth/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        DPoP: await dpopProof(tokenEndpoint),
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: callback,
        client_id: clientId,
        code_verifier: verifier,
        resource,
      }),
    });
    assert.equal(bound.status, 400, await bound.clone().text());
    assert.equal((await fixture.client.query("SELECT 1 FROM oauth_access_token")).rows.length, 0);

    // A key thumbprint in the authorization request is ignored rather than binding the code.
    const tokens = await connect(clientId, person.cookie, "read offline_access", {
      dpop_jkt: "0ZcOCORZNYy-DWpqq30jZyJGHTN0d2HglBV3uiguA4I",
      prompt: "consent",
    });
    assert.ok(await verifyMcpAccess(fixture.db, api, tokens.access_token));
    // A token carrying a key confirmation never counts as a Bearer token.
    await fixture.client.query(
      `UPDATE oauth_access_token SET confirmation = '{"jkt":"0ZcOCORZNYy-DWpqq30jZyJGHTN0d2HglBV3uiguA4I"}'`,
    );
    assert.equal(await verifyMcpAccess(fixture.db, api, tokens.access_token), null);
  });

  it("lets only verified accounts approve and keeps connections private to their account", async () => {
    const restricted = await account("restricted", false);
    const clientId = await register();
    const { challenge } = await pkce();
    const page = await authorize(authorizeURL(clientId, challenge), restricted.cookie);
    assert.equal(page.origin + page.pathname, `${web}/connect`);
    const approved = await consent(page, restricted.cookie, "read");
    assert.equal(approved.status, 403);
    assert.equal(((await approved.json()) as { code: string }).code, "EMAIL_NOT_VERIFIED");
    assert.equal(
      (
        await request("/api/auth/connections", {
          headers: { Cookie: restricted.cookie, Origin: web },
        })
      ).status,
      403,
    );

    const owner = await account("owner");
    const intruder = await account("intruder");
    const tokens = await connect(clientId, owner.cookie, "read");
    await json(
      "/api/auth/connections/revoke",
      { clientId },
      { Cookie: intruder.cookie, Origin: web },
    );
    assert.ok(await verifyMcpAccess(fixture.db, api, tokens.access_token));

    // Denying sends the agent an error and grants nothing.
    const { challenge: denied } = await pkce();
    const deniedPage = await authorize(authorizeURL(clientId, denied), intruder.cookie);
    const refusal = await consent(deniedPage, intruder.cookie, undefined, false);
    const url = new URL(((await refusal.json()) as { url: string }).url);
    assert.equal(url.searchParams.get("error"), "access_denied");
  });

  it("registers clients from metadata documents through the HTTPS-only transport", async (t) => {
    const clientId = "https://agent.example/oauth/client.json";
    const document = {
      client_id: clientId,
      client_name: "Metadata agent",
      logo_uri: "https://agent.example/logo.png",
      redirect_uris: [callback],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    };
    const fetches = t.mock.method(globalThis, "fetch", async (input: Request) => {
      assert.equal(input.url, clientId);
      assert.equal(input.redirect, "manual");
      return Response.json(document, { headers: { "Cache-Control": "max-age=60" } });
    });
    const person = await account("metadata");
    const tokens = await connect(clientId, person.cookie, "read offline_access");
    assert.ok(fetches.mock.callCount() >= 1);
    assert.deepEqual((await verifyMcpAccess(fixture.db, api, tokens.access_token))?.client, {
      id: clientId,
      name: "Metadata agent",
    });
    const listed = await request("/api/auth/connections", {
      headers: { Cookie: person.cookie, Origin: web },
    });
    const { connections } = (await listed.json()) as { connections: { logoUri: string }[] };
    assert.equal(connections[0]?.logoUri, "https://agent.example/logo.png");

    // A document that redirects elsewhere is refused, not followed.
    fetches.mock.mockImplementation(async () =>
      Response.redirect("https://elsewhere.example/client.json", 302),
    );
    const { challenge } = await pkce();
    const redirected = await request(
      authorizeURL("https://redirecting.example/client.json", challenge)
        .toString()
        .slice(api.length),
      { headers: { Cookie: person.cookie }, redirect: "manual" },
    );
    assert.equal(redirected.status, 400);
    assert.equal(((await redirected.json()) as { error: string }).error, "invalid_client");
    assert.equal(
      (fetches.mock.calls.at(-1)!.arguments[0] as Request).url,
      "https://redirecting.example/client.json",
    );
  });

  it("accepts metadata documents only where the switch is on, as in deployed stages", async (t) => {
    clientMetadataDocuments = undefined;
    const fetches = t.mock.method(globalThis, "fetch", async () => Response.json({}));
    const metadata = await request("/.well-known/oauth-authorization-server/api/auth");
    const document = (await metadata.json()) as Record<string, unknown>;
    assert.equal(document.client_id_metadata_document_supported, undefined);
    const person = await account("local");
    const { challenge } = await pkce();
    const refused = await request(
      authorizeURL("https://looks-public.example/client.json", challenge)
        .toString()
        .slice(api.length),
      { headers: { Cookie: person.cookie }, redirect: "manual" },
    );
    const error = new URL(refused.headers.get("location")!);
    assert.equal(error.searchParams.get("error"), "invalid_client");
    assert.equal(fetches.mock.callCount(), 0);
    // Dynamic registration keeps working.
    const tokens = await connect(await register(), person.cookie, "read");
    assert.ok(await verifyMcpAccess(fixture.db, api, tokens.access_token));
  });

  it("rate-limits unauthenticated registration per address", async () => {
    const attempts = [];
    for (let i = 0; i < 31; i++)
      attempts.push(
        (
          await json(
            "/api/auth/oauth2/register",
            {
              client_name: `Agent ${i}`,
              redirect_uris: [callback],
              token_endpoint_auth_method: "none",
            },
            { "cf-connecting-ip": "203.0.113.9" },
          )
        ).status,
      );
    assert.deepEqual([...new Set(attempts.slice(0, 30))], [201]);
    assert.equal(attempts[30], 429);
  });
});
