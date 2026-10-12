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

/** Serve the same immutable metadata stored with each uniquely addressed upload. */
export async function readPhoto(
  bucket: Pick<R2Bucket, "get">,
  key: string,
): Promise<Response | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", mediaCacheControl);
  return new Response(object.body, { headers });
}
