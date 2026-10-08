import { favorites, groups, links } from "@index/db/schema/app";
import { and, eq, sql } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { databaseError } from "../../errors";
import { groupSelection } from "../groups/repository";

export function findFavoritesGroup(db: QueryDatabase, actorId: string) {
  return ResultAsync.fromPromise(
    db
      .select(groupSelection)
      .from(groups)
      .where(and(eq(groups.ownerId, actorId), eq(groups.kind, "favorites")))
      .limit(1)
      .then((rows) => rows[0]),
    databaseError,
  );
}
export function favoriteLink(db: QueryDatabase, actorId: string, linkId: string) {
  return ResultAsync.fromPromise(
    db
      .insert(favorites)
      .select(
        db
          .select({
            ownerId: links.ownerId,
            linkId: links.id,
            createdAt: sql<Date>`now()`.as("created_at"),
          })
          .from(links)
          .where(and(eq(links.ownerId, actorId), eq(links.id, linkId))),
      )
      .onConflictDoUpdate({ target: [favorites.ownerId, favorites.linkId], set: { linkId } })
      .returning({ linkId: favorites.linkId })
      .then((rows) => rows[0]),
    databaseError,
  );
}
export function unfavoriteLink(db: QueryDatabase, actorId: string, linkId: string) {
  return ResultAsync.fromPromise(
    db
      .delete(favorites)
      .where(and(eq(favorites.ownerId, actorId), eq(favorites.linkId, linkId)))
      .then(() => ({ success: true as const })),
    databaseError,
  );
}
