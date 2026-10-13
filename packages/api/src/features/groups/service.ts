import { err, ok, okAsync } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { notFound } from "../../errors";
import { decodeCursor, toPage } from "../../pagination";
import * as repository from "./repository";
import type { CreateGroupInput, UpdateGroupInput } from "./schemas";

export const createGroup = (db: QueryDatabase, actorId: string, input: CreateGroupInput) =>
  repository
    .insertGroup(db, actorId, input)
    .andThen((group) => (group ? ok(group) : err(notFound("Group"))));
export const getGroup = (db: QueryDatabase, viewerId: string | null, id: string) =>
  repository
    .findGroup(db, viewerId, id)
    .andThen((group) => (group ? ok(group) : err(notFound("Group"))));
export const updateGroup = (db: QueryDatabase, actorId: string, input: UpdateGroupInput) =>
  repository
    .findGroup(db, actorId, input.id)
    .andThen((group) =>
      group?.kind === "starred" && input.visibility === "public"
        ? err({ code: "BAD_REQUEST" as const, message: "Starred is always private." })
        : group?.kind === "favorites" && input.visibility === "private"
          ? err({ code: "BAD_REQUEST" as const, message: "Favorites can't be locked." })
          : repository.updateGroup(db, actorId, input),
    )
    .andThen((group) => (group ? ok(group) : err(notFound("Editable group"))));
export const deleteGroup = (db: QueryDatabase, actorId: string, id: string, deleteLinks: boolean) =>
  repository
    .deleteGroup(db, actorId, id, deleteLinks)
    .andThen((group) =>
      group ? ok({ success: true as const }) : err(notFound("Deletable group")),
    );

export function listGroups(
  db: QueryDatabase,
  viewerId: string | null,
  ownerId: string,
  limit: number,
  cursor?: string,
) {
  const decoded = cursor ? decodeCursor(cursor) : ok(undefined);
  return decoded.asyncAndThen((value) => {
    const ready =
      viewerId === ownerId
        ? repository
            .ensureSystemGroup(db, ownerId, "starred")
            .andThen(() => repository.ensureSystemGroup(db, ownerId, "favorites"))
        : okAsync(undefined);
    return ready
      .andThen(() => repository.listGroups(db, viewerId, ownerId, limit + 1, value))
      .map((rows) => toPage(rows, limit));
  });
}
