import { user } from "@index/db/schema/auth";
import { eq } from "drizzle-orm";
import { err, ok } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { notFound } from "../../errors";
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
    .andThen((profile) => (profile ? ok(profile) : err(notFound("Profile"))));
}

export const updateProfile = (db: QueryDatabase, actorId: string, input: UpdateProfileInput) =>
  repository
    .updateProfile(db, actorId, input)
    .andThen(() => getProfile(db, actorId, { userId: actorId }));
