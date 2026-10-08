import { err, errAsync, ok } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { notFound } from "../../errors";
import { getProfile } from "../profiles/service";
import * as repository from "./repository";

export function followUser(db: QueryDatabase, actorId: string, targetId: string) {
  if (actorId === targetId)
    return errAsync({ code: "BAD_REQUEST" as const, message: "You cannot follow yourself." });
  return repository
    .followUser(db, actorId, targetId)
    .andThen((value) => (value ? ok(value) : err(notFound("Profile"))));
}
export const acceptFollow = (db: QueryDatabase, actorId: string, followerId: string) =>
  repository
    .acceptFollow(db, actorId, followerId)
    .andThen((value) => (value ? ok(value) : err(notFound("Follow request"))));
export { removeFollow } from "./repository";

export function listNetwork(
  db: QueryDatabase,
  viewerId: string | null,
  userId: string,
  direction: "followers" | "following" | "requests",
  limit: number,
  after?: string,
) {
  return getProfile(db, viewerId, { userId })
    .andThen((profile) =>
      profile.canViewContent ? ok(profile) : err(notFound("Profile contents")),
    )
    .andThen(() => repository.listNetwork(db, viewerId, userId, direction, limit + 1, after))
    .map((rows) => {
      const items = rows.slice(0, limit);
      return { items, nextAfter: rows.length > limit ? items.at(-1)!.id : null };
    });
}
