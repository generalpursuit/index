import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createECDH, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { createPushAdapter } from "./adapters";
import { notificationCapabilities, type PushConfig } from "./config";
import type { DeliveryDestination } from "@index/api/features/notifications/delivery";
const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const unbase64 = (value: string) => Buffer.from(value, "base64url");
import type { Alert } from "@index/api/features/notifications/schemas";
const alert: Alert = {
  id: "b21e13bd-73b3-46ee-9e36-4a9c8c18b172",
  recipientId: "alice",
  title: "Index",
  body: "You have a new message.",
  path: "/messages/opaqueRoute",
  conversationId: "conversation",
};
const apnsDestination: Extract<DeliveryDestination, { kind: "apns" }> = {
  kind: "apns",
  token: "a".repeat(64),
  environment: "sandbox",
};
async function keys() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const pkcs8 = new Uint8Array(
    (await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer,
  );
  return {
    pair,
    pub: base64url(raw),
    privateKey: jwk.d!,
    pem:
      "-----BEGIN PRIVATE KEY-----\n" +
      btoa(String.fromCharCode(...pkcs8)) +
      "\n-----END PRIVATE KEY-----",
  };
}
// Independent Node-crypto receiver verifies the WebCrypto sender's RFC 8291 wire format.
function decrypt(bytes: Uint8Array, receiver: ReturnType<typeof createECDH>, auth: Uint8Array) {
  const b = Buffer.from(bytes),
    salt = b.subarray(0, 16);
  assert.equal(b.readUInt32BE(16), 4096);
  assert.equal(b[20], 65);
  const sender = b.subarray(21, 86),
    encrypted = b.subarray(86),
    shared = receiver.computeSecret(sender);
  const ikm = hkdfSync(
    "sha256",
    shared,
    auth,
    Buffer.concat([Buffer.from("WebPush: info\0"), receiver.getPublicKey(), sender]),
    32,
  );
  const key = hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12);
  const decipher = createDecipheriv("aes-128-gcm", Buffer.from(key), Buffer.from(nonce));
  decipher.setAuthTag(encrypted.subarray(-16));
  const plaintext = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]);
  assert.equal(plaintext.at(-1), 2);
  return plaintext.subarray(0, -1).toString();
}
describe("real push adapters with fake network", () => {
  it("sends encrypted wake identifiers only and signs a correct VAPID audience", async () => {
    const k = await keys(),
      receiver = createECDH("prime256v1");
    receiver.generateKeys();
    const auth = randomBytes(16);
    const d = {
      kind: "web" as const,
      endpoint: "https://fcm.googleapis.com/fcm/send/fixture",
      p256dh: base64url(receiver.getPublicKey()),
      auth: base64url(auth),
    };
    let calls = 0;
    const ciphertexts: Uint8Array[] = [];
    const send = await createPushAdapter(
      {
        NOTIFICATIONS_ENABLED: "true",
        VAPID_PUBLIC_KEY: k.pub,
        VAPID_PRIVATE_KEY: k.privateKey,
        VAPID_SUBJECT: "mailto:ops@example.test",
      },
      (async (_url, init) => {
        calls++;
        assert.equal(init?.redirect, "error");
        const h = new Headers(init!.headers);
        assert.equal(h.get("Topic"), alert.id.replaceAll("-", ""));
        assert.equal(h.get("TTL"), "300");
        assert.equal(h.get("Urgency"), "normal");
        assert.equal(h.get("Content-Encoding"), "aes128gcm");
        assert.ok(init?.signal instanceof AbortSignal);
        assert.equal(init.signal.aborted, false);
        const jwt = h
          .get("Authorization")!
          .match(/^vapid t=([^,]+)/)![1]!
          .split(".");
        assert.equal(
          JSON.parse(Buffer.from(jwt[1]!, "base64url").toString()).aud,
          "https://fcm.googleapis.com",
        );
        const claims = JSON.parse(Buffer.from(jwt[1]!, "base64url").toString());
        assert.equal(claims.sub, "mailto:ops@example.test");
        assert.ok(Math.abs(claims.exp - Date.now() / 1000 - 3600) < 3);
        assert.equal(
          await crypto.subtle.verify(
            { name: "ECDSA", hash: "SHA-256" },
            k.pair.publicKey,
            unbase64(jwt[2]!),
            new TextEncoder().encode(jwt.slice(0, 2).join(".")),
          ),
          true,
        );
        const bytes = init!.body as Uint8Array;
        ciphertexts.push(bytes);
        const payload = decrypt(bytes, receiver, auth);
        assert.deepEqual(JSON.parse(payload), { id: alert.id });
        assert.equal(payload.includes("alice"), false);
        assert.equal(payload.includes("message"), false);
        return new Response(null, { status: 201 });
      }) as typeof fetch,
    );
    assert.deepEqual(await send(d, alert), { status: "sent" });
    assert.deepEqual(await send(d, alert), { status: "sent" });
    assert.equal(calls, 2);
    assert.notDeepEqual(ciphertexts[0]!.subarray(0, 86), ciphertexts[1]!.subarray(0, 86));
  });
  it("signs APNs requests, collapses retries, expires offline delivery and carries no hidden preview", async () => {
    const k = await keys();
    const env: PushConfig = {
      NOTIFICATIONS_ENABLED: "true",
      APNS_PRIVATE_KEY: k.pem,
      APNS_KEY_ID: "KEY1234567",
      APNS_TEAM_ID: "TEAM123456",
      APNS_TOPIC: "com.example.index",
      APNS_ENVIRONMENT: "sandbox",
    };
    const send = await createPushAdapter(env, (async (url, init) => {
      assert.equal(String(url), "https://api.sandbox.push.apple.com/3/device/" + "a".repeat(64));
      const h = new Headers(init?.headers);
      assert.equal(h.get("apns-collapse-id"), alert.id);
      assert.equal(h.get("apns-expiration"), "0");
      assert.equal(h.get("apns-topic"), env.APNS_TOPIC!);
      const [header, claims, signature] = h.get("authorization")!.slice(7).split(".");
      assert.equal(JSON.parse(Buffer.from(header!, "base64url").toString()).kid, "KEY1234567");
      assert.equal(JSON.parse(Buffer.from(claims!, "base64url").toString()).iss, "TEAM123456");
      assert.equal(
        await crypto.subtle.verify(
          { name: "ECDSA", hash: "SHA-256" },
          k.pair.publicKey,
          unbase64(signature!),
          new TextEncoder().encode(header + "." + claims),
        ),
        true,
      );
      assert.deepEqual(JSON.parse(String(init?.body)), {
        aps: { alert: { title: "Index", body: alert.body }, sound: "default" },
        index: {
          id: alert.id,
          recipientId: "alice",
          path: alert.path,
          conversationId: "conversation",
        },
      });
      return new Response(null, { status: 200 });
    }) as typeof fetch);
    assert.deepEqual(await send(apnsDestination, alert), { status: "sent" });
    assert.equal(
      (await send({ ...apnsDestination, environment: "production" }, alert)).status,
      "retry",
    );
    for (const [status, expected, body] of [
      [410, "dead", ""],
      [400, "dead", '{"reason":"BadDeviceToken"}'],
      [403, "retry", ""],
      [429, "retry", ""],
      [503, "retry", ""],
    ] as const) {
      const adapter = await createPushAdapter(
        env,
        (async () =>
          new Response(body, { status, headers: { "Retry-After": "120" } })) as typeof fetch,
      );
      assert.equal((await adapter(apnsDestination, alert)).status, expected);
    }
  });
  it("reports unconfigured delivery honestly without calling providers", async () => {
    assert.equal((await notificationCapabilities({})).web, false);
    assert.equal((await notificationCapabilities({})).apns, false);
    let called = false;
    await (
      await createPushAdapter({}, (async () => {
        called = true;
        return new Response();
      }) as typeof fetch)
    )(apnsDestination, alert);
    assert.equal(called, false);
  });
});

async function configuredEnvironment(): Promise<PushConfig> {
  const k = await keys();
  return {
    NOTIFICATIONS_ENABLED: "true",
    VAPID_PUBLIC_KEY: k.pub,
    VAPID_PRIVATE_KEY: k.privateKey,
    VAPID_SUBJECT: "mailto:ops@example.test",
    APNS_PRIVATE_KEY: k.pem,
    APNS_KEY_ID: "KEY1234567",
    APNS_TEAM_ID: "TEAM123456",
    APNS_TOPIC: "com.example.index",
    APNS_ENVIRONMENT: "sandbox",
  };
}

it("validates keys before enrollment and isolates malformed provider configuration", async () => {
  const env = await configuredEnvironment();
  assert.deepEqual(await notificationCapabilities(env), {
    web: true,
    apns: true,
    desktop: true,
    vapidPublicKey: env.VAPID_PUBLIC_KEY,
    apnsEnvironment: "sandbox",
  });
  const warnings: unknown[][] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    for (const override of [
      { VAPID_PRIVATE_KEY: "secret-invalid-key" },
      { VAPID_PUBLIC_KEY: "secret-invalid-public-key" },
      { VAPID_SUBJECT: "mailto:" },
      { VAPID_SUBJECT: "https://" },
      { VAPID_SUBJECT: "ftp://example.test" },
      { VAPID_PRIVATE_KEY: (await keys()).privateKey },
    ]) {
      const broken = { ...env, ...override };
      assert.deepEqual(await notificationCapabilities(broken), {
        web: false,
        apns: true,
        desktop: true,
        vapidPublicKey: null,
        apnsEnvironment: "sandbox",
      });
      const before = warnings.length;
      await notificationCapabilities(broken);
      assert.equal(
        warnings.length,
        before,
        "configuration is checked once per immutable bindings object",
      );
    }
    for (const override of [
      { APNS_PRIVATE_KEY: "secret-invalid-apple-key" },
      { APNS_KEY_ID: "KEY" },
      { APNS_TEAM_ID: "TEAM" },
      { APNS_TOPIC: "invalid topic" },
      { APNS_ENVIRONMENT: "development" },
    ]) {
      const capabilities = await notificationCapabilities({ ...env, ...override });
      assert.equal(capabilities.apns, false);
      assert.equal(capabilities.apnsEnvironment, null);
      assert.equal(capabilities.web, true);
      assert.equal(capabilities.desktop, true);
    }
    const wrongCurve = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-384" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const wrongPEM =
      "-----BEGIN PRIVATE KEY-----\n" +
      Buffer.from(await crypto.subtle.exportKey("pkcs8", wrongCurve.privateKey)).toString(
        "base64",
      ) +
      "\n-----END PRIVATE KEY-----";
    assert.equal(
      (await notificationCapabilities({ ...env, APNS_PRIVATE_KEY: wrongPEM })).apns,
      false,
    );
    assert.ok(warnings.length > 0);
    const output = JSON.stringify(warnings);
    for (const value of [env.VAPID_PRIVATE_KEY!, env.APNS_PRIVATE_KEY!, "secret-invalid"]) {
      assert.equal(output.includes(value), false);
    }
    const before = warnings.length;
    assert.deepEqual(await notificationCapabilities({ ...env, NOTIFICATIONS_ENABLED: "false" }), {
      web: false,
      apns: false,
      desktop: true,
      vapidPublicKey: null,
      apnsEnvironment: null,
    });
    assert.equal(warnings.length, before);
  } finally {
    console.warn = warn;
  }
});

it("rejects untrusted endpoints and malformed destination keys before making a network request", async () => {
  const env = await configuredEnvironment();
  let called = false;
  const send = await createPushAdapter(env, (async () => {
    called = true;
    return new Response();
  }) as typeof fetch);
  for (const endpoint of [
    "https://example.test/private",
    "http://fcm.googleapis.com/private",
    "https://fcm.googleapis.com.evil.test/private",
    "https://user:password@fcm.googleapis.com/private",
    "https://fcm.googleapis.com:8443/private",
    "https://fcm.googleapis.com/private#fragment",
    null,
  ]) {
    assert.deepEqual(
      await send(
        { kind: "web", endpoint, p256dh: env.VAPID_PUBLIC_KEY!, auth: base64url(randomBytes(16)) },
        alert,
      ),
      {
        status: "dead",
        reason: "invalid_destination",
      },
    );
  }
  for (const [p256dh, auth] of [
    [null, null],
    ["bad", base64url(randomBytes(16))],
    [env.VAPID_PUBLIC_KEY!, base64url(randomBytes(15))],
    [base64url(new Uint8Array([4, ...new Uint8Array(64)])), base64url(randomBytes(16))],
  ]) {
    assert.equal(
      (
        await send(
          {
            kind: "web",
            endpoint: "https://fcm.googleapis.com/push",
            p256dh: p256dh ?? null,
            auth: auth ?? null,
          },
          alert,
        )
      ).status,
      "dead",
    );
  }
  assert.deepEqual(await send({ ...apnsDestination, token: "not-a-token" }, alert), {
    status: "dead",
    reason: "invalid_destination",
  });
  assert.deepEqual(await send({ ...apnsDestination, environment: "production" }, alert), {
    status: "retry",
    reason: "provider_configuration",
  });
  assert.equal(called, false);
});

it("records safe failure categories and retry metadata without discarding credentials failures", async () => {
  const env = await configuredEnvironment();
  for (const [status, reason] of [
    [401, "provider_authentication"],
    [403, "provider_authentication"],
    [429, "rate_limited"],
    [503, "provider_unavailable"],
    [413, "provider_rejected"],
  ] as const) {
    const send = await createPushAdapter(
      env,
      (async () =>
        new Response("sensitive provider response", {
          status,
          headers: { "Retry-After": "120" },
        })) as typeof fetch,
    );
    const result = await send(apnsDestination, alert);
    assert.equal(result.status, "retry");
    assert.equal(result.reason, reason);
    if (status === 429 || status === 503) assert.equal(result.retryAfter, 120);
    assert.equal(JSON.stringify(result).includes("sensitive"), false);
  }
  for (const [header, minimum, maximum] of [
    [new Date(Date.now() + 120_000).toUTCString(), 115, 121],
    ["invalid", 0, 0],
    ["Infinity", 0, 0],
    ["Wed, 01 Jan 2020 00:00:00 GMT", 0, 0],
  ] as const) {
    const send = await createPushAdapter(
      env,
      (async () =>
        new Response(null, {
          status: 503,
          headers: { "Retry-After": header },
        })) as typeof fetch,
    );
    const result = await send(apnsDestination, alert);
    assert.ok(result.retryAfter! >= minimum && result.retryAfter! <= maximum);
  }
  for (const reason of ["BadDeviceToken", "DeviceTokenNotForTopic", "BadTopic"]) {
    const send = await createPushAdapter(
      env,
      (async () => new Response(JSON.stringify({ reason }), { status: 400 })) as typeof fetch,
    );
    assert.deepEqual(
      await send(apnsDestination, alert),
      reason === "BadTopic"
        ? { status: "retry", reason: "provider_configuration" }
        : { status: "dead", reason: "invalid_destination" },
    );
  }
  const offline = await createPushAdapter(env, (async () => {
    throw new Error("sensitive provider failure");
  }) as typeof fetch);
  assert.deepEqual(await offline(apnsDestination, alert), {
    status: "retry",
    reason: "network_error",
  });
});

it("keeps the durable APNs cache identity and reuses its token locally", async () => {
  const env = await configuredEnvironment();
  let lookups = 0;
  let token: string;
  const sent: string[] = [];
  const send = await createPushAdapter(
    env,
    (async (_url, init) => {
      assert.equal(init?.redirect, "error");
      assert.ok(init?.signal instanceof AbortSignal);
      const headers = new Headers(init.headers);
      assert.equal(headers.get("apns-push-type"), "alert");
      assert.equal(headers.get("apns-priority"), "10");
      assert.equal(headers.get("apns-id"), alert.id);
      sent.push(headers.get("authorization")!);
      return new Response();
    }) as typeof fetch,
    async (key, issue) => {
      lookups++;
      const expected = Buffer.from(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(
            `${env.APNS_TEAM_ID}:${env.APNS_KEY_ID}:${env.APNS_PRIVATE_KEY}`,
          ),
        ),
      ).toString("hex");
      assert.equal(key, expected);
      token = await issue();
      return token;
    },
  );
  await send(apnsDestination, alert);
  await send(apnsDestination, alert);
  assert.equal(lookups, 1);
  assert.deepEqual(sent, [`bearer ${token!}`, `bearer ${token!}`]);
});
