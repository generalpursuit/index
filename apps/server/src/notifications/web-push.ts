import { encryptNotification } from "@block65/webcrypto-web-push";
import { base64url, compactVerify, importJWK, SignJWT } from "jose";
import type {
  DeliveryDestination,
  DeliveryResult,
} from "@index/api/features/notifications/delivery";
import type { Alert } from "@index/api/features/notifications/schemas";
import { validPushEndpoint } from "@index/api/features/notifications/endpoints";
import { requestPush, responseOutcome } from "./transport";

export interface WebPushEnvironment {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

function decodeKey(value: string, length: number) {
  const bytes = base64url.decode(value);
  if (bytes.length !== length || base64url.encode(bytes) !== value)
    throw new Error("Invalid Web Push key encoding");
  return bytes;
}

export async function configureWebPush(env: WebPushEnvironment) {
  const {
    VAPID_PUBLIC_KEY: publicKey,
    VAPID_PRIVATE_KEY: privateKey,
    VAPID_SUBJECT: subject,
  } = env;
  if (!publicKey && !privateKey && !subject) return null;
  if (!publicKey || !privateKey || !subject) throw new Error("Incomplete VAPID configuration");
  const contact = new URL(subject);
  if (
    !(contact.protocol === "mailto:" && /^[^@\s]+@[^@\s]+$/.test(contact.pathname)) &&
    !(contact.protocol === "https:" && contact.hostname && !contact.username && !contact.password)
  )
    throw new Error("Invalid VAPID contact");
  const bytes = decodeKey(publicKey, 65);
  decodeKey(privateKey, 32);
  if (bytes[0] !== 4) throw new Error("Invalid VAPID public key");
  const publicJWK = {
    kty: "EC",
    crv: "P-256",
    x: base64url.encode(bytes.slice(1, 33)),
    y: base64url.encode(bytes.slice(33)),
  };
  const key = await importJWK({ ...publicJWK, d: privateKey }, "ES256");
  // Import alone need not prove that the public point belongs to the private scalar.
  const proof = await new SignJWT({}).setProtectedHeader({ alg: "ES256" }).sign(key);
  await compactVerify(proof, await importJWK(publicJWK, "ES256"));
  return { publicKey, subject, key };
}

export function createWebPushSender(
  config: NonNullable<Awaited<ReturnType<typeof configureWebPush>>>,
  network: typeof fetch,
) {
  return async (
    destination: Extract<DeliveryDestination, { kind: "web" }>,
    alert: Alert,
  ): Promise<DeliveryResult> => {
    const { endpoint, p256dh, auth } = destination;
    if (!endpoint || !validPushEndpoint(endpoint) || !p256dh || !auth)
      return { status: "dead", reason: "invalid_destination" };
    try {
      const point = decodeKey(p256dh, 65);
      decodeKey(auth, 16);
      if (point[0] !== 4) throw new Error("Invalid subscription point");
      await crypto.subtle.importKey("raw", point, { name: "ECDH", namedCurve: "P-256" }, false, []);
    } catch {
      return { status: "dead", reason: "invalid_destination" };
    }
    const token = await new SignJWT({})
      .setProtectedHeader({ typ: "JWT", alg: "ES256" })
      .setAudience(new URL(endpoint).origin)
      .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
      .setSubject(config.subject)
      .sign(config.key);
    // Wake-up only: resolve content with the browser's current cookie + installation.
    const body = await encryptNotification(
      { endpoint, expirationTime: null, keys: { p256dh, auth } },
      new TextEncoder().encode(JSON.stringify({ id: alert.id })),
      { pad: false },
    );
    const response = await requestPush(network, endpoint, {
      headers: {
        Authorization: `vapid t=${token}, k=${config.publicKey}`,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: "300",
        Topic: alert.id.replaceAll("-", ""),
        Urgency: "normal",
      },
      body,
    });
    return response ? responseOutcome(response) : { status: "retry", reason: "network_error" };
  };
}
