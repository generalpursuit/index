/**
 * Where profile photos are kept: an R2 bucket on Cloudflare, memory in tests and local
 * fixtures. Objects are addressed by key; the store also knows its own public addresses, so
 * a replaced or removed photo can be deleted.
 */
export type MediaStore = {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** The public address of a stored object. */
  url(key: string): string;
  /** The key behind an address this store handed out, or null for any other address. */
  keyOf(url: string): string | null;
};

/** Photos arrive already squared and shrunk by the client; this limit is the backstop. */
export const maxPhotoBytes = 5 * 1024 * 1024;

/**
 * What an upload really is, read from its first bytes rather than trusting the declared type
 * (which some runtimes drop and any client can fake). Only JPEG, PNG and WebP are photos.
 */
export function photoType(bytes: Uint8Array) {
  const starts = (...signature: (number | null)[]) =>
    signature.every((byte, index) => byte === null || bytes[index] === byte);
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  // "RIFF", four bytes of size, "WEBP".
  if (starts(0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50))
    return "image/webp";
  return null;
}

const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
/** A new key per upload, so a photo's address can be cached for good. */
export const photoKey = (userId: string, contentType: string) =>
  `avatars/${userId}/${crypto.randomUUID()}.${extensions[contentType] ?? "bin"}`;

/** Addresses look like `<base>/media/<key>`; the server serves that path from the store. */
export function mediaAddresses(base: string) {
  const prefix = base.replace(/\/$/, "") + "/media/";
  return {
    url: (key: string) => prefix + key,
    keyOf: (url: string) => (url.startsWith(prefix) ? url.slice(prefix.length) : null),
  };
}

/** Keeps objects in memory: for tests and the local sample backend. */
export function memoryMediaStore(base: string) {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  const store: MediaStore & {
    get(key: string): { body: Uint8Array; contentType: string } | undefined;
  } = {
    ...mediaAddresses(base),
    async put(key, body, contentType) {
      objects.set(key, { body, contentType });
    },
    async delete(key) {
      objects.delete(key);
    },
    get: (key) => objects.get(key),
  };
  return store;
}
