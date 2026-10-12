import { user, usernameAliases } from "@index/db/schema/auth";
import { eq, sql } from "drizzle-orm";
import { err, ok, ResultAsync } from "neverthrow";
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
      "userId" in lookup
        ? eq(user.id, lookup.userId)
        : sql`${user.id} = (select ${usernameAliases.userId} from ${usernameAliases} where ${usernameAliases.username} = ${lookup.username})`,
    )
    .andThen((profile) => (profile ? ok(profile) : err(notFound("Profile"))))
    .andThen((profile) =>
      repository
        .followedBy(db, viewerId, profile.id)
        .map((followedBy) => ({ ...profile, followedBy })),
    );
}

/** Removing the photo (`image: null`) also deletes it from storage. */
export async function updateProfile(
  db: QueryDatabase,
  media: MediaStore,
  actorId: string,
  input: UpdateProfileInput,
) {
  const changed = await repository.updateProfile(db, actorId, input);
  if (changed.isErr()) return err(changed.error);
  if (!changed.value) return err(notFound("Profile"));
  if (input.image === null) await forget(media, changed.value.previousImage);
  return getProfile(db, actorId, { userId: actorId });
}

/** Stores a new photo under a fresh address, points the profile at it and drops the old one. */
export async function uploadImage(
  db: QueryDatabase,
  media: MediaStore,
  actorId: string,
  file: Blob,
) {
  const read = await ResultAsync.fromPromise(
    file.arrayBuffer().then((buffer) => new Uint8Array(buffer)),
    databaseError,
  );
  if (read.isErr()) return err(read.error);
  const type = photoType(read.value);
  if (!type)
    return err({ code: "BAD_REQUEST" as const, message: "Upload a JPEG, PNG or WebP image." });
  const key = photoKey(actorId, type);
  const image = media.url(key);
  const stored = await ResultAsync.fromPromise(media.put(key, read.value, type), databaseError);
  if (stored.isErr()) {
    // A provider can store the object and lose its response. No database write has
    // begun, so this fresh, unreferenced key is always safe to discard.
    await forget(media, image);
    return err(stored.error);
  }
  const changed = await repository.updateProfile(db, actorId, { image });
  if (changed.isErr()) {
    // A rejected response can arrive before an accepted write commits. A fresh
    // read cannot fence that write, so retain the upload on every database error.
    // This may leave an orphan, but never deletes a possibly active photo.
    console.warn("Profile photo cleanup deferred: database outcome unknown.");
    return err(changed.error);
  }
  if (!changed.value) {
    await forget(media, image);
    return err(notFound("Profile"));
  }
  await forget(media, changed.value.previousImage);
  return getProfile(db, actorId, { userId: actorId });
}

/** Deletes a photo this store holds; anything else (or nothing) is left alone. */
async function forget(media: MediaStore, image: string | null) {
  const key = image ? media.keyOf(image) : null;
  if (!key) return;
  try {
    await media.delete(key);
  } catch {
    // Storage cleanup does not undo a committed profile change. Never expose
    // storage errors, object addresses or account identity in operational logs.
    console.warn("Profile photo cleanup failed.");
  }
}
