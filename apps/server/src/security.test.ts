import { Hono } from "hono";
import { mountAuthentication } from "./authentication";
import { createAuth } from "@index/auth";
import type { SecurityEmail } from "@index/auth/delivery";
import { createTestDatabase } from "@index/api/testing/database";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { apiHandler, rpcHandler } from "./transport";

const password = "secure-test-password-123";
const origin = "https://api.example.com";
const config = {
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: "test-only-secret-with-at-least-32-characters",
  CORS_ORIGIN: "https://web.example.com",
};
describe("verification and account security", () => {
  let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
  let auth: ReturnType<typeof createAuth>;
  let mail: SecurityEmail[];
  let failDelivery = false;
  let background: Promise<unknown>[];
  before(async () => {
    fixture = await createTestDatabase();
  });
  beforeEach(async () => {
    await Promise.all(background ?? []);
    await fixture.reset();
    mail = [];
    background = [];
    failDelivery = false;
    auth = createAuth(config, fixture.db, [], {
      sendEmail: async (email) => {
        if (failDelivery) throw new Error("provider unavailable");
        mail.push(email);
      },
      backgroundTask: (task) => {
        background.push(task);
      },
    });
  });
  after(async () => {
    await Promise.all(background ?? []);
    await fixture?.close();
  });
  const headers = (token: string, cookie = false): Record<string, string> =>
    cookie
      ? { Cookie: `__Secure-better-auth.session_token=${token}` }
      : { Authorization: `Bearer ${token}` };
  async function post(path: string, body: unknown, token?: string, cookie = false) {
    return auth.handler(
      new Request(`${origin}/api/auth${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? headers(token, cookie) : {}) },
        body: JSON.stringify(body),
      }),
    );
  }
  async function signup(name = "reader") {
    const response = await post("/sign-up/email", {
      name,
      username: name,
      email: `${name}@example.test`,
      password,
    });
    assert.equal(response.status, 200, await response.clone().text());
    const token = response.headers.get("set-auth-token");
    assert.ok(token);
    return {
      token,
      user: (
        (await response.json()) as { user: { id: string; email: string; emailVerified: boolean } }
      ).user,
    };
  }
  const session = (token: string, cookie = false) =>
    auth.api.getSession({ headers: new Headers(headers(token, cookie)) });
  async function verify(token: string, email = "reader@example.test") {
    const code = mail.findLast(
      (message) => message.to === email && message.purpose === "verify",
    )!.code;
    const response = await post("/security/verify-email", { code }, token);
    assert.equal(response.status, 200, await response.clone().text());
    return code;
  }
  async function app(token: string, path = "/me/profile", cookie = false) {
    const result = await apiHandler.handle(
      new Request(`${origin}/api/v1${path}`, { headers: headers(token, cookie) }),
      {
        prefix: "/api/v1",
        context: { ...fixture.context(null), session: await session(token, cookie) },
      },
    );
    assert.ok(result.matched);
    return result.response;
  }
  async function elapse() {
    // Disposable clock advancement without sleeps or altering production code.
    await fixture.client.exec(
      "UPDATE auth_challenge SET sent_at=now()-interval '61 seconds'; UPDATE auth_throttle SET expires_at=now()-interval '1 second' WHERE count=1",
    );
  }
  it("signs up restricted, verifies a six-digit single-use code, then supports email and username password login", async () => {
    const { token, user } = await signup();
    assert.equal(user.emailVerified, false);
    assert.match(mail[0]!.code, /^\d{6}$/);
    for (const cookie of [false, true]) {
      assert.equal((await app(token, "/me/profile", cookie)).status, 403);
      assert.equal((await app(token, `/profiles/${user.id}`, cookie)).status, 403);
      assert.equal((await session(token, cookie))?.user.emailVerified, false);
    }
    const stored = await fixture.client.query<{ code_hash: string }>(
      "select code_hash from auth_challenge",
    );
    assert.notEqual(stored.rows[0]?.code_hash, mail[0]!.code);
    const code = await verify(token);
    assert.equal((await app(token)).status, 200);
    assert.equal((await post("/security/verify-email", { code }, token)).status, 400);
    for (const [field, value] of [
      ["email", user.email],
      ["username", "reader"],
    ]) {
      assert.equal((await post(`/sign-in/${field}`, { [field!]: value, password })).status, 200);
      assert.equal(
        (await post(`/sign-in/${field}`, { [field!]: value, password: "wrong-password" })).status,
        401,
      );
    }
    assert.equal((await post("/sign-in/email-otp", { email: user.email, otp: code })).status, 404);
    assert.equal(
      (await post("/email-otp/send-verification-otp", { email: user.email, type: "sign-in" }))
        .status,
      404,
    );
  });
  for (const method of ["email", "username"] as const) {
    it(`sends verification on unverified ${method} sign-in, bound to the new session`, async () => {
      const original = await signup();
      await fixture.client.exec("TRUNCATE auth_challenge, auth_throttle");
      mail.length = 0;
      const identifier = method === "email" ? original.user.email : "reader";
      assert.equal(
        (await post(`/sign-in/${method}`, { [method]: identifier, password: "wrong-password" }))
          .status,
        401,
      );
      assert.equal(mail.length, 0);
      const login = await post(`/sign-in/${method}`, { [method]: identifier, password });
      assert.equal(login.status, 200);
      const token = login.headers.get("set-auth-token")!;
      assert.ok(token);
      assert.equal(mail.length, 1);
      assert.equal(mail[0]!.to, original.user.email);
      assert.equal(mail[0]!.purpose, "verify");
      assert.equal((await app(token)).status, 403);
      assert.equal(
        (await post("/security/verify-email", { code: mail[0]!.code }, original.token)).status,
        400,
      );
      await verify(token);
      assert.equal((await app(token)).status, 200);
      assert.equal(
        (await post(`/sign-in/${method}`, { [method]: identifier, password })).status,
        200,
      );
      assert.equal(mail.length, 1, "Verified sign-in must not send another verification code");
    });
  }
  it("retains restricted sign-in and resend limits when automatic verification delivery fails", async () => {
    const original = await signup();
    await fixture.client.exec("TRUNCATE auth_challenge, auth_throttle");
    mail.length = 0;
    failDelivery = true;
    const login = await post("/sign-in/email", { email: original.user.email, password });
    assert.equal(login.status, 200);
    const token = login.headers.get("set-auth-token")!;
    assert.ok(token);
    assert.equal((await app(token)).status, 403);
    const status = await auth.handler(
      new Request(`${origin}/api/auth/security/status`, { headers: headers(token) }),
    );
    assert.equal(
      ((await status.json()) as { verification: { delivery: string } }).verification.delivery,
      "failed",
    );
    assert.equal((await post("/security/send-verification", {}, token)).status, 429);
    failDelivery = false;
    const retry = await post("/sign-in/email", { email: original.user.email, password });
    assert.equal(retry.status, 200, "A send cooldown must not discard a valid restricted session");
    assert.equal(mail.length, 0, "Repeated sign-in must not bypass the send cooldown");
    await elapse();
    assert.equal((await post("/security/send-verification", {}, token)).status, 200);
    await verify(token);
  });
  it("gates preexisting accounts and stale cookie/bearer sessions with fresh verification state, including RPC", async () => {
    const { token, user } = await signup();
    await verify(token);
    await fixture.client.query('UPDATE "user" SET email_verified=false WHERE id=$1', [user.id]);
    for (const cookie of [false, true]) {
      assert.equal((await app(token, "/me/profile", cookie)).status, 403);
      assert.equal((await session(token, cookie))?.user.emailVerified, false);
      const response = await rpcHandler.handle(
        new Request(`${origin}/rpc/v1/profiles/me`, {
          method: "POST",
          headers: { ...headers(token, cookie), "Content-Type": "application/json" },
          body: JSON.stringify({ json: {} }),
        }),
        {
          prefix: "/rpc/v1",
          context: { ...fixture.context(null), session: await session(token, cookie) },
        },
      );
      assert.ok(response.matched);
      assert.equal(response.response.status, 403);
    }
    assert.equal(
      (await post("/update-user", { emailVerified: true, email: "other@example.test" }, token))
        .status,
      403,
    );
    assert.equal(
      (await post("/change-email", { newEmail: "other@example.test" }, token)).status,
      404,
    );
    assert.equal((await post("/sign-out", {}, token)).status, 200);
    assert.equal(await session(token), null);
  });
  it("keeps resolver reads public for anonymous callers but rejects restricted cookie and bearer identities", async () => {
    const { token } = await signup();
    const path = "/u/reader";
    const publicRead = await apiHandler.handle(
      new Request(`${origin}/api/v1/routes/resolve?path=${encodeURIComponent(path)}`),
      {
        prefix: "/api/v1",
        context: fixture.context(null),
      },
    );
    assert.ok(publicRead.matched);
    assert.equal(publicRead.response.status, 200);
    for (const cookie of [false, true]) {
      assert.equal(
        (await app(token, `/routes/resolve?path=${encodeURIComponent(path)}`, cookie)).status,
        403,
      );
      const rpc = await rpcHandler.handle(
        new Request(`${origin}/rpc/v1/routes/resolve`, {
          method: "POST",
          headers: { ...headers(token, cookie), "Content-Type": "application/json" },
          body: JSON.stringify({ json: { path } }),
        }),
        {
          prefix: "/rpc/v1",
          context: { ...fixture.context(null), session: await session(token, cookie) },
        },
      );
      assert.ok(rpc.matched);
      assert.equal(rpc.response.status, 403);
      assert.equal(
        ((await rpc.response.json()) as { json: { data: { code: string } } }).json.data.code,
        "EMAIL_NOT_VERIFIED",
      );
    }
    await verify(token);
    assert.equal(
      (await app(token, `/routes/resolve?path=${encodeURIComponent(path)}`)).status,
      200,
    );
  });
  it("binds email correction to its signed signup session and password, retaining the old address until proof", async () => {
    const original = await signup();
    const attacker = await signup("attacker");
    const oldCode = mail[0]!.code;
    assert.equal(
      (await post("/security/correct-email", { email: "correct@example.test", password })).status,
      401,
    );
    assert.equal(
      (
        await post(
          "/security/correct-email",
          { email: "correct@example.test", password: "incorrect-password" },
          original.token,
        )
      ).status,
      400,
    );
    await elapse();
    assert.equal(
      (
        await post(
          "/security/correct-email",
          { email: "correct@example.test", password },
          original.token,
        )
      ).status,
      200,
    );
    assert.equal((await session(original.token))?.user.email, original.user.email);
    const code = mail.at(-1)!.code;
    assert.equal((await post("/security/verify-email", { code }, attacker.token)).status, 400);
    assert.equal(
      (await post("/security/verify-email", { code: oldCode }, original.token)).status,
      400,
    );
    await verify(original.token, "correct@example.test");
    assert.equal((await session(original.token))?.user.email, "correct@example.test");
    assert.equal((await session(attacker.token))?.user.emailVerified, false);
  });
  it("has race-safe single consumption and a five-guess ceiling, including parallel guesses", async () => {
    const { token } = await signup();
    const code = mail[0]!.code;
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        post("/security/verify-email", { code: code === "000000" ? "111111" : "000000" }, token),
      ),
    );
    assert.ok(results.every((result) => result.status === 400));
    assert.equal((await post("/security/verify-email", { code }, token)).status, 400);
    await elapse();
    assert.equal((await post("/security/send-verification", {}, token)).status, 200);
    const final = await Promise.all(
      Array.from({ length: 6 }, () =>
        post("/security/verify-email", { code: mail.at(-1)!.code }, token),
      ),
    );
    assert.equal(final.filter((response) => response.status === 200).length, 1);
  });
  it("rejects expired codes and bounds concurrent resends with a shared cooldown", async () => {
    const { token } = await signup();
    assert.equal((await post("/security/send-verification", {}, token)).status, 429);
    await fixture.client.exec("UPDATE auth_challenge SET expires_at=now()-interval '1 second'");
    assert.equal(
      (await post("/security/verify-email", { code: mail[0]!.code }, token)).status,
      400,
    );
    await elapse();
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => post("/security/send-verification", {}, token)),
    );
    assert.equal(responses.filter((response) => response.status === 200).length, 1);
    assert.equal(mail.length, 2);
  });
  it("recovers without enumeration, changes the password atomically, revokes all sessions, and never logs in by code", async () => {
    const { token, user } = await signup();
    const other = await post("/sign-in/email", { email: user.email, password });
    const otherToken = other.headers.get("set-auth-token")!;
    const existing = await post("/security/request-reset", { email: user.email });
    const missing = await post("/security/request-reset", { email: "unknown@example.test" });
    assert.equal(existing.status, missing.status);
    assert.deepEqual(await existing.json(), await missing.json());
    await Promise.all(background);
    assert.equal(mail.filter((item) => item.purpose === "reset").length, 1);
    const reset = mail.at(-1)!;
    assert.equal(
      (
        await post("/security/reset-password", {
          email: "unknown@example.test",
          code: reset.code,
          newPassword: "new-test-password",
        })
      ).status,
      400,
    );
    const response = await post("/security/reset-password", {
      email: user.email,
      code: reset.code,
      newPassword: "new-test-password",
    });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get("set-auth-token"), null);
    for (const old of [token, otherToken])
      for (const cookie of [false, true]) assert.equal(await session(old, cookie), null);
    assert.equal((await post("/sign-in/email", { email: user.email, password })).status, 401);
    const loggedIn = await post("/sign-in/email", {
      email: user.email,
      password: "new-test-password",
    });
    assert.equal(loggedIn.status, 200);
    assert.equal(
      ((await loggedIn.json()) as { user: { emailVerified: boolean } }).user.emailVerified,
      true,
    );
    assert.equal(
      (
        await post("/security/reset-password", {
          email: user.email,
          code: reset.code,
          newPassword: password,
        })
      ).status,
      400,
    );
  });
  it("requires current passwords for changes and verifies the new email before replacement", async () => {
    const { token, user } = await signup();
    await verify(token);
    const oldSession = await post("/sign-in/email", { email: user.email, password });
    assert.equal(
      (
        await post(
          "/security/change-password",
          { currentPassword: "wrong-password", newPassword: "replacement-password" },
          token,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          "/security/change-password",
          { currentPassword: password, newPassword: "replacement-password" },
          token,
        )
      ).status,
      200,
    );
    assert.equal(await session(oldSession.headers.get("set-auth-token")!), null);
    assert.equal(
      (
        await post(
          "/security/request-email-change",
          { email: "changed@example.test", password },
          token,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          "/security/request-email-change",
          { email: "changed@example.test", password: "replacement-password" },
          token,
        )
      ).status,
      200,
    );
    assert.equal((await session(token))?.user.email, user.email);
    const code = mail.at(-1)!.code;
    assert.equal((await post("/security/confirm-email-change", { code }, token)).status, 200);
    assert.equal((await session(token))?.user.email, "changed@example.test");
    assert.equal(
      (await post("/sign-in/email", { email: user.email, password: "replacement-password" }))
        .status,
      401,
    );
    assert.equal(
      (
        await post("/sign-in/email", {
          email: "changed@example.test",
          password: "replacement-password",
        })
      ).status,
      200,
    );
  });
  it("reports failed delivery safely and recovers through a later resend; reset failures remain generic", async () => {
    failDelivery = true;
    const { token, user } = await signup();
    assert.equal(mail.length, 0);
    const status = await auth.handler(
      new Request(`${origin}/api/auth/security/status`, { headers: headers(token) }),
    );
    assert.equal(
      ((await status.json()) as { verification: { delivery: string } }).verification.delivery,
      "failed",
    );
    const reset = await post("/security/request-reset", { email: user.email });
    const missing = await post("/security/request-reset", { email: "missing@example.test" });
    assert.deepEqual(await reset.json(), await missing.json());
    await Promise.all(background);
    await elapse();
    failDelivery = false;
    assert.equal((await post("/security/send-verification", {}, token)).status, 200);
    await verify(token);
  });
  it("rejects untrusted origins, direct link/reset backdoors and client verification flags", async () => {
    const result = await auth.handler(
      new Request(`${origin}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
        body: JSON.stringify({ name: "Bad", username: "bad", email: "bad@example.test", password }),
      }),
    );
    assert.equal(result.status, 403);
    const response = await post("/sign-up/email", {
      name: "Flag",
      username: "flag",
      email: "flag@example.test",
      password,
      emailVerified: true,
    });
    assert.equal(response.status, 200);
    assert.equal(
      ((await response.json()) as { user: { emailVerified: boolean } }).user.emailVerified,
      false,
    );
    for (const path of ["/reset-password", "/request-password-reset", "/change-password"])
      assert.equal((await post(path, { token: "fake", newPassword: password })).status, 404);
    assert.equal(
      (await auth.handler(new Request(`${origin}/api/auth/verify-email?token=fake`))).status,
      404,
    );
  });
  it("runs recovery delivery through the production Worker route's waitUntil without delaying or exposing its outcome", async () => {
    const { user } = await signup();
    let release!: () => void;
    let delivered = false;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tasks: Promise<unknown>[] = [];
    const worker = new Hono();
    mountAuthentication(worker, async (backgroundTask) =>
      createAuth(config, fixture.db, [], {
        backgroundTask,
        sendEmail: async () => {
          await pending;
          delivered = true;
          throw new Error("simulated provider outage");
        },
      }),
    );
    const context = {
      waitUntil: (task: Promise<unknown>) => {
        tasks.push(task);
      },
      passThroughOnException() {},
      props: {},
    };
    try {
      const response = await worker.fetch(
        new Request(`${origin}/api/auth/security/request-reset`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: user.email }),
        }),
        {},
        context,
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { success: true, retryAfter: 60 });
      assert.equal(delivered, false);
      assert.ok(tasks.length > 0, "delivery must be registered on Worker execution context");
    } finally {
      release();
      await Promise.all(tasks);
    }
    assert.equal(delivered, true);
    const result = await fixture.client.query<{ delivery: string }>(
      "select delivery from auth_challenge where purpose='reset'",
    );
    assert.equal(result.rows[0]?.delivery, "failed");
  });
  it("cleans expired unknown-email challenges and throttles in bounded batches without deleting active codes", async () => {
    const { token } = await signup();
    await post("/security/request-reset", { email: "unknown@example.test" });
    await Promise.all(background);
    await fixture.client.exec(
      "UPDATE auth_challenge SET expires_at=now()-interval '2 days' WHERE user_id IS NULL; UPDATE auth_throttle SET expires_at=now()-interval '2 days'",
    );
    await post("/security/request-reset", { email: "another@example.test" });
    await Promise.all(background);
    const expired = await fixture.client.query<{ count: number }>(
      "select count(*)::integer as count from auth_challenge where expires_at<now()-interval '1 day'",
    );
    assert.equal(expired.rows[0]?.count, 0);
    const limits = await fixture.client.query<{ count: number }>(
      "select count(*)::integer as count from auth_throttle where expires_at<now()-interval '1 day'",
    );
    assert.equal(limits.rows[0]?.count, 0);
    await verify(token);
  });

  it("keeps old usernames reserved through Better Auth signup and availability checks, including concurrent registrations", async () => {
    const { user } = await signup();
    await fixture.client.query('UPDATE "user" SET username=$1 WHERE id=$2', [
      "reader_new",
      user.id,
    ]);
    const available = await post("/is-username-available", { username: "READER" });
    assert.deepEqual(await available.json(), { available: false });
    const reserved = await post("/sign-up/email", {
      name: "Other",
      username: "reader",
      email: "other@example.test",
      password,
    });
    assert.equal(reserved.status, 400);
    const results = await Promise.all(
      ["first", "second"].map((name) =>
        post("/sign-up/email", {
          name,
          username: "one_winner",
          email: `${name}@example.test`,
          password,
        }),
      ),
    );
    assert.equal(results.filter((response) => response.status === 200).length, 1);
    assert.ok(
      results
        .filter((response) => response.status !== 200)
        .every((response) => [400, 422].includes(response.status)),
    );
    assert.equal(
      (
        await fixture.client.query(
          "select user_id from username_aliases where username='one_winner'",
        )
      ).rows.length,
      1,
    );
  });
  it("does not replace another account's email and invalidates an in-flight change after password reset", async () => {
    const first = await signup();
    await verify(first.token);
    const other = await signup("another");
    await verify(other.token, other.user.email);
    assert.equal(
      (
        await post(
          "/security/request-email-change",
          { email: other.user.email, password },
          first.token,
        )
      ).status,
      200,
    );
    assert.equal(
      (await post("/security/confirm-email-change", { code: mail.at(-1)!.code }, first.token))
        .status,
      409,
    );
    assert.equal((await session(first.token))?.user.email, first.user.email);
    await elapse();
    assert.equal(
      (
        await post(
          "/security/request-email-change",
          { email: "free@example.test", password },
          first.token,
        )
      ).status,
      200,
    );
    const changeCode = mail.at(-1)!.code;
    await post("/security/request-reset", { email: first.user.email });
    await Promise.all(background);
    assert.equal(
      (
        await post("/security/reset-password", {
          email: first.user.email,
          code: mail.at(-1)!.code,
          newPassword: "updated-password",
        })
      ).status,
      200,
    );
    assert.equal(
      (await post("/security/confirm-email-change", { code: changeCode }, first.token)).status,
      401,
    );
  });
});
