import type { FileStore } from "@index/api/features/messages/files";

/** Message files in their private bucket. Nothing serves this bucket directly. */
export function r2FileStore(bucket: R2Bucket): FileStore {
  return {
    async put(key, body) {
      await bucket.put(key, body);
    },
    async get(key) {
      return (await bucket.get(key))?.blob() ?? null;
    },
    delete: (key) => bucket.delete(key),
  };
}
