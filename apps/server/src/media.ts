import { mediaAddresses, type MediaStore } from "@index/api/features/profiles/media";

/** Every stored photo has its own address, so it can be cached for good. */
export const mediaCacheControl = "public, max-age=31536000, immutable";

/** Profile photos in the R2 bucket, addressed under this server's `/media/` path. */
export function r2MediaStore(bucket: R2Bucket, base: string): MediaStore {
  return {
    ...mediaAddresses(base),
    async put(key, body, contentType) {
      await bucket.put(key, body, {
        httpMetadata: { contentType, cacheControl: mediaCacheControl },
      });
    },
    delete: (key) => bucket.delete(key),
  };
}
