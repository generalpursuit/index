import { test } from "node:test";
import assert from "node:assert/strict";
import { resendTransport } from "@index/auth/delivery";

const config = {
  CORS_ORIGIN: "https://configured.example",
  AUTH_EMAIL_FROM: "Index <accounts@sender.example>",
  RESEND_API_KEY: "disposable-test-key",
};
test("Resend uses the configured sender, server-only authorization and per-challenge idempotency", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    assert.equal(input, "https://api.resend.com/emails");
    assert.equal(init?.method, "POST");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Authorization"), "Bearer disposable-test-key");
    assert.equal(headers.get("Idempotency-Key"), "index-auth-disposable-challenge");
    assert.ok(init?.signal instanceof AbortSignal);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.from, config.AUTH_EMAIL_FROM);
    assert.deepEqual(body.to, ["reader@example.test"]);
    assert.match(body.text, /123456.*reset your password/);
    assert.match(body.text, /https:\/\/configured.example\/login/);
    assert.match(body.text, /10 minutes.*once/);
    assert.match(body.text, /password remains your sign-in method/);
    return Response.json({ id: "provider-message" });
  }) as typeof fetch;
  try {
    await resendTransport(config)({
      to: "reader@example.test",
      code: "123456",
      purpose: "reset",
      id: "disposable-challenge",
    });
  } finally {
    globalThis.fetch = original;
  }
});
test("provider errors do not expose response bodies, recipient, credential or code", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("sensitive provider details", { status: 503 })) as typeof fetch;
  try {
    await assert.rejects(
      resendTransport(config)({
        to: "reader@example.test",
        code: "123456",
        purpose: "verify",
        id: "disposable-challenge",
      }),
      { message: "Email delivery failed." },
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("missing delivery credentials fail safely without making a network request", async () => {
  await assert.rejects(
    resendTransport({ CORS_ORIGIN: config.CORS_ORIGIN })({
      to: "reader@example.test",
      code: "123456",
      purpose: "change-email",
      id: "disposable-challenge",
    }),
    { message: "Email delivery is not configured." },
  );
});
