import { err, ok } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { notFound } from "../../errors";
import { ensureSystemGroup } from "../groups/repository";
import { listInGroup } from "../links/service";
import * as repository from "./repository";

export const getFavoritesGroup = (db: QueryDatabase, actorId: string) =>
  ensureSystemGroup(db, actorId, "favorites")
    .andThen(() => repository.findFavoritesGroup(db, actorId))
    .andThen((group) => (group ? ok(group) : err(notFound("Favorites group"))));

export const favoriteLink = (db: QueryDatabase, actorId: string, linkId: string) =>
  getFavoritesGroup(db, actorId)
    .andThen(() => repository.favoriteLink(db, actorId, linkId))
    .andThen((link) => (link ? ok({ success: true as const }) : err(notFound("Link"))));

export const listFavorites = (
  db: QueryDatabase,
  actorId: string,
  input: { limit: number; cursor?: string },
) =>
  getFavoritesGroup(db, actorId).andThen((group) =>
    listInGroup(db, actorId, { ...input, groupId: group.id }),
  );
export { unfavoriteLink } from "./repository";
