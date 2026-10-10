const encoder = new TextEncoder();
export const utf8 = (s: string) => encoder.encode(s);
export function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
export function unbase64(value: string) {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
}
function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8),
  );
}
/** RFC 8291, single aes128gcm record. P-256 ECDH, random salt and a fresh sender key per message. */
export async function encryptPush(p256dh: string, auth: string, plaintext: string) {
  const receiverBytes = unbase64(p256dh),
    authBytes = unbase64(auth);
  if (receiverBytes.length !== 65 || receiverBytes[0] !== 4 || authBytes.length !== 16)
    throw new Error("Invalid subscription keys");
  const receiver = await crypto.subtle.importKey(
    "raw",
    receiverBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sender = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const senderBytes = new Uint8Array(
    (await crypto.subtle.exportKey("raw", sender.publicKey)) as ArrayBuffer,
  );
  // workerd's generated types spell this standard WebCrypto field `$public`.
  const agreement = { name: "ECDH", public: receiver };
  const shared = new Uint8Array(await crypto.subtle.deriveBits(agreement, sender.privateKey, 256));
  const ikm = await hkdf(
    shared,
    authBytes,
    concat(utf8("WebPush: info\0"), receiverBytes, senderBytes),
    32,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    await hkdf(ikm, salt, utf8("Content-Encoding: aes128gcm\0"), 16),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const nonce = await hkdf(ikm, salt, utf8("Content-Encoding: nonce\0"), 12);
  const message = concat(utf8(plaintext), new Uint8Array([2]));
  if (message.length + 16 > 4096) throw new Error("Push payload too large");
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, message),
  );
  return concat(salt, new Uint8Array([0, 0, 16, 0, 65]), senderBytes, ciphertext);
}
export async function signJWT(key: CryptoKey, header: object, claims: object) {
  const input =
    base64url(utf8(JSON.stringify(header))) + "." + base64url(utf8(JSON.stringify(claims)));
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(input)),
  );
  return input + "." + base64url(signature);
}
export async function vapidKey(publicKey: string, privateKey: string) {
  const bytes = unbase64(publicKey);
  if (bytes.length !== 65 || bytes[0] !== 4) throw new Error("Invalid VAPID key");
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: base64url(bytes.slice(1, 33)),
      y: base64url(bytes.slice(33)),
      d: privateKey,
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}
export function apnsKey(pem: string) {
  return crypto.subtle.importKey(
    "pkcs8",
    unbase64(pem.replace(/-----[^-]+-----|\s/g, "")),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}
