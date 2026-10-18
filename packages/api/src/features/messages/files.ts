import { photoType } from "../profiles/media";

/**
 * Where message files are kept: a private R2 bucket on Cloudflare, memory in tests and the
 * local sample backend. Unlike profile photos, stored files have no public address; members
 * read them through the API.
 */
export type FileStore = {
  /** Stores an upload as it arrived, without another copy in memory. */
  put(key: string, body: Blob): Promise<void>;
  get(key: string): Promise<Blob | null>;
  delete(key: string): Promise<void>;
};

// Counted as people see sizes in Finder and on iOS, where a megabyte is a million bytes.
export const maxFileBytes = 25_000_000;
export const maxFilesPerMessage = 10;
/** The image types served inline: what `servedType` can return besides octet-stream. */
export const inlineImageTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/**
 * The type a file is served as, read from its first bytes. Images that clients show inline
 * keep their type; anything else is opaque bytes, so no browser renders it on the API origin.
 */
export function servedType(bytes: Uint8Array) {
  const gif = [0x47, 0x49, 0x46, 0x38].every((byte, index) => bytes[index] === byte);
  return photoType(bytes) ?? (gif ? "image/gif" : "application/octet-stream");
}

/** A fresh key per upload, grouped by conversation. */
export const fileKey = (conversationId: string) =>
  `conversations/${conversationId}/${crypto.randomUUID()}`;

// Control characters, bidirectional formatting that could disguise an extension, and line breaks.
const hidden = /[\p{Cc}\p{Bidi_Control}\u2028\u2029]/gu;

/**
 * The name members see: no folders or hidden characters, never empty, and at most 200
 * characters, keeping a short extension so the file still opens as its kind.
 */
export function fileName(name: string | undefined) {
  const visible = ((name ?? "").split(/[\\/]/).pop() ?? "").replace(hidden, "").trim();
  if (!visible.replace(/\./g, "")) return "File";
  const characters = [...visible];
  if (characters.length <= 200) return visible;
  const extension = /\.[^.\s]{1,16}$/.exec(visible)?.[0] ?? "";
  // Counted in code points, so no character is cut into a lone surrogate.
  return (
    characters
      .slice(0, 200 - extension.length)
      .join("")
      .trimEnd() + extension
  );
}

/** Keeps files in memory: for tests and the local sample backend. */
export function memoryFileStore() {
  const objects = new Map<string, Blob>();
  const store: FileStore & { keys(): string[] } = {
    async put(key, body) {
      objects.set(key, body);
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
    async delete(key) {
      objects.delete(key);
    },
    keys: () => [...objects.keys()],
  };
  return store;
}
