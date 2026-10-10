import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createECDH, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { createPushAdapter, notificationCapabilities, type PushConfig } from "./adapters";
import { base64url, encryptPush, unbase64 } from "./crypto";
import type { notificationDevices } from "@index/db/schema/notifications";
import type { Alert } from "@index/api/features/notifications/schemas";
const alert: Alert = {
  id: "b21e13bd-73b3-46ee-9e36-4a9c8c18b172",
  recipientId: "alice",
  title: "Index",
  body: "You have a new message.",
  path: "/messages/opaqueRoute",
  conversationId: "conversation",
};
function device(kind: "apns" | "web") {
  return {
    id: "device",
    installationHash: "hash",
    endpointHash: "endpoint-hash",
    userId: "alice",
    sessionId: "session",
    kind,
    endpoint: "a".repeat(64),
    p256dh: null,
    auth: null,
    environment: "sandbox",
    activeConversationId: null,
    activeUntil: null,
    createdAt: new Date(),
  } as typeof notificationDevices.$inferSelect;
}
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
it("Web Push uses interoperable encryption and unique salt and ephemeral key per send", async () => {
  const receiver = createECDH("prime256v1");
  receiver.generateKeys();
  const auth = randomBytes(16);
  const input = [base64url(receiver.getPublicKey()), base64url(auth), "hello"] as const;
  const first = await encryptPush(...input),
    second = await encryptPush(...input);
  assert.equal(decrypt(first, receiver, auth), "hello");
  assert.equal(decrypt(second, receiver, auth), "hello");
  assert.notDeepEqual(first.subarray(0, 86), second.subarray(0, 86));
});
describe("real push adapters with fake network", () => {
  it("sends encrypted wake identifiers only and signs a correct VAPID audience", async () => {
    const k = await keys(),
      receiver = createECDH("prime256v1");
    receiver.generateKeys();
    const auth = randomBytes(16);
    const d = {
      ...device("web"),
      endpoint: "https://fcm.googleapis.com/fcm/send/fixture",
      p256dh: base64url(receiver.getPublicKey()),
      auth: base64url(auth),
    };
    let calls = 0;
    const send = createPushAdapter(
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
        const jwt = h
          .get("Authorization")!
          .match(/^vapid t=([^,]+)/)![1]!
          .split(".");
        assert.equal(
          JSON.parse(Buffer.from(jwt[1]!, "base64url").toString()).aud,
          "https://fcm.googleapis.com",
        );
        assert.equal(
          await crypto.subtle.verify(
            { name: "ECDSA", hash: "SHA-256" },
            k.pair.publicKey,
            unbase64(jwt[2]!),
            new TextEncoder().encode(jwt.slice(0, 2).join(".")),
          ),
          true,
        );
        const payload = decrypt(init!.body as Uint8Array, receiver, auth);
        assert.deepEqual(JSON.parse(payload), { id: alert.id });
        assert.equal(payload.includes("alice"), false);
        assert.equal(payload.includes("message"), false);
        return new Response(null, { status: 201 });
      }) as typeof fetch,
    );
    assert.deepEqual(await send(d, alert), { status: "sent" });
    assert.equal(calls, 1);
  });
  it("signs APNs requests, collapses retries, expires offline delivery and carries no hidden preview", async () => {
    const k = await keys();
    const env: PushConfig = {
      NOTIFICATIONS_ENABLED: "true",
      APNS_PRIVATE_KEY: k.pem,
      APNS_KEY_ID: "KEY",
      APNS_TEAM_ID: "TEAM",
      APNS_TOPIC: "com.example.index",
      APNS_ENVIRONMENT: "sandbox",
    };
    const send = createPushAdapter(env, (async (url, init) => {
      assert.equal(String(url), "https://api.sandbox.push.apple.com/3/device/" + "a".repeat(64));
      const h = new Headers(init?.headers);
      assert.equal(h.get("apns-collapse-id"), alert.id);
      assert.equal(h.get("apns-expiration"), "0");
      assert.equal(h.get("apns-topic"), env.APNS_TOPIC!);
      const [header, claims, signature] = h.get("authorization")!.slice(7).split(".");
      assert.equal(JSON.parse(Buffer.from(header!, "base64url").toString()).kid, "KEY");
      assert.equal(JSON.parse(Buffer.from(claims!, "base64url").toString()).iss, "TEAM");
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
    assert.deepEqual(await send(device("apns"), alert), { status: "sent" });
    assert.equal(
      (await send({ ...device("apns"), environment: "production" }, alert)).status,
      "retry",
    );
    for (const [status, expected, body] of [
      [410, "dead", ""],
      [400, "dead", '{"reason":"BadDeviceToken"}'],
      [403, "retry", ""],
      [429, "retry", ""],
      [503, "retry", ""],
    ] as const) {
      const adapter = createPushAdapter(
        env,
        (async () =>
          new Response(body, { status, headers: { "Retry-After": "120" } })) as typeof fetch,
      );
      assert.equal((await adapter(device("apns"), alert)).status, expected);
    }
  });
  it("reports unconfigured delivery honestly and refuses arbitrary endpoint origins", async () => {
    assert.equal(notificationCapabilities({}).web, false);
    assert.equal(notificationCapabilities({}).apns, false);
    let called = false;
    await createPushAdapter({}, (async () => {
      called = true;
      return new Response();
    }) as typeof fetch)(device("apns"), alert);
    assert.equal(called, false);
  });
});
