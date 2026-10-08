import { createAuth } from "@index/auth";
import { createTestDatabase } from "@index/api/testing/database";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { apiHandler } from "./transport";

describe("native and browser authentication", () => {
  let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
  before(async () => {
    fixture = await createTestDatabase();
  });
  beforeEach(async () => {
    await fixture.reset();
  });
  after(async () => {
    await fixture?.close();
  });

  const auth = () =>
    createAuth(
      {
        BETTER_AUTH_URL: "https://api.example.com",
        BETTER_AUTH_SECRET: "test-only-secret-with-at-least-32-characters",
        CORS_ORIGIN: "https://web.example.com",
      },
      fixture.db,
    );
  const post = (path: string, body: unknown, headers?: HeadersInit) =>
    new Request(`https://api.example.com/api/auth${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...Object.fromEntries(new Headers(headers)) },
      body: JSON.stringify(body),
    });

  it("registers, logs in, restores a signed bearer session, calls the API and revokes on logout", async () => {
    const authentication = auth();
    const credentials = { email: "native@example.com", password: "secure-test-password-123" };
    const registered = await authentication.handler(
      post("/sign-up/email", { ...credentials, name: "Native user" }),
    );
    assert.equal(registered.status, 200, await registered.clone().text());
    assert.match(registered.headers.get("set-cookie") ?? "", /HttpOnly/i);
    const signedIn = await authentication.handler(post("/sign-in/email", credentials));
    assert.equal(signedIn.status, 200);
    const token = signedIn.headers.get("set-auth-token");
    assert.ok(token);
    const headers = new Headers({ Authorization: `Bearer ${token}` });
    const restored = await authentication.api.getSession({ headers });
    assert.equal(restored?.user.email, credentials.email);
    const result = await apiHandler.handle(
      new Request("https://api.example.com/api/v1/links", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com", title: "From iOS" }),
      }),
      { prefix: "/api/v1", context: { db: fixture.db, session: restored } },
    );
    assert.ok(result.matched);
    assert.equal(result.response.status, 201);
    const cookieValue = registered.headers.get("set-auth-token");
    assert.ok(cookieValue);
    const cookieHeaders = new Headers({
      Cookie: `__Secure-better-auth.session_token=${cookieValue}`,
    });
    assert.equal(
      (await authentication.api.getSession({ headers: cookieHeaders }))?.user.email,
      credentials.email,
    );
    assert.equal((await authentication.handler(post("/sign-out", {}, headers))).status, 200);
    assert.equal(await authentication.api.getSession({ headers }), null);
  });

  it("rejects unsigned, tampered and expired bearer tokens", async () => {
    const authentication = auth();
    const response = await authentication.handler(
      post("/sign-up/email", {
        email: "expiry@example.com",
        password: "secure-test-password-123",
        name: "Expiry",
      }),
    );
    assert.equal(response.status, 200);
    const token = response.headers.get("set-auth-token");
    assert.ok(token);
    const headers = new Headers({ Authorization: `Bearer ${token}` });
    const restored = await authentication.api.getSession({ headers });
    assert.ok(restored);
    for (const invalid of [restored.session.token, `${token}bad`]) {
      assert.equal(
        await authentication.api.getSession({
          headers: new Headers({ Authorization: `Bearer ${invalid}` }),
        }),
        null,
      );
    }
    await fixture.client.query('UPDATE "session" SET expires_at = $1 WHERE id = $2', [
      new Date(0),
      restored.session.id,
    ]);
    assert.equal(await authentication.api.getSession({ headers }), null);
  });

  it("publishes the authentication OpenAPI contract for native clients", async () => {
    const response = await auth().handler(
      new Request("https://api.example.com/api/auth/open-api/generate-schema"),
    );
    assert.equal(response.status, 200);
    const document = JSON.stringify(await response.json());
    assert.match(document, /sign-in\/email/);
    assert.match(document, /get-session/);
    assert.match(document, /sign-out/);
    assert.match(document, /bearerAuth/);
  });
});
