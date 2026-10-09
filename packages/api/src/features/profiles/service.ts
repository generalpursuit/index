import { user } from "@index/db/schema/auth";
import { eq } from "drizzle-orm";
import { err, ok, okAsync, ResultAsync } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { databaseError, notFound } from "../../errors";
import { photoKey, photoType, type MediaStore } from "./media";
import * as repository from "./repository";
import type { UpdateProfileInput } from "./schemas";

export function getProfile(
  db: QueryDatabase,
  viewerId: string | null,
  lookup: { userId: string } | { username: string },
) {
  return repository
    .findProfile(
      db,
      viewerId,
      "userId" in lookup ? eq(user.id, lookup.userId) : eq(user.username, lookup.username),
    )
    .andThen((profile) => (profile ? ok(profile) : err(notFound("Profile"))))
    .andThen((profile) =>
      repository
        .followedBy(db, viewerId, profile.id)
        .map((followedBy) => ({ ...profile, followedBy })),
    );
}

/** Removing the photo (`image: null`) also deletes it from storage. */
export const updateProfile = (
  db: QueryDatabase,
  media: MediaStore,
  actorId: string,
  input: UpdateProfileInput,
) =>
  repository
    .findImage(db, actorId)
    .andThen((previous) =>
      repository
        .updateProfile(db, actorId, input)
        .andThen(() => (input.image === null ? forget(media, previous) : okAsync(undefined))),
    )
    .andThen(() => getProfile(db, actorId, { userId: actorId }));

/** Stores a new photo under a fresh address, points the profile at it and drops the old one. */
export function uploadImage(db: QueryDatabase, media: MediaStore, actorId: string, file: Blob) {
  return ResultAsync.fromPromise(
    file.arrayBuffer().then((buffer) => new Uint8Array(buffer)),
    databaseError,
  )
    .andThen((bytes) => {
      const type = photoType(bytes);
      return type
        ? ok({ bytes, type })
        : err({ code: "BAD_REQUEST" as const, message: "Upload a JPEG, PNG or WebP image." });
    })
    .andThen(({ bytes, type }) => {
      const key = photoKey(actorId, type);
      return ResultAsync.fromPromise(media.put(key, bytes, type), databaseError).map(() => key);
    })
    .andThen((key) =>
      repository
        .findImage(db, actorId)
        .andThen((previous) =>
          repository
            .updateProfile(db, actorId, { image: media.url(key) })
            .andThen(() => forget(media, previous)),
        ),
    )
    .andThen(() => getProfile(db, actorId, { userId: actorId }));
}

/** Deletes a photo this store holds; anything else (or nothing) is left alone. */
function forget(media: MediaStore, image: string | null) {
  const key = image ? media.keyOf(image) : null;
  return key ? ResultAsync.fromPromise(media.delete(key), databaseError) : okAsync(undefined);
}
