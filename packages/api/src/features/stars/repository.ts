import { groups, links, stars } from "@index/db/schema/app";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { linkVisible } from "../../data-access/visibility";
import { databaseError } from "../../errors";
import { groupSelection } from "../groups/repository";

export function findStarredGroup(db: QueryDatabase, actorId: string) {
  return ResultAsync.fromPromise(
    db
      .select(groupSelection)
      .from(groups)
      .where(and(eq(groups.ownerId, actorId), eq(groups.kind, "starred")))
      .limit(1)
      .then((rows) => rows[0]),
    databaseError,
  );
}

export function starLink(db: QueryDatabase, actorId: string, linkId: string) {
  return ResultAsync.fromPromise(
    db
      .insert(stars)
      .select(
        db
          .select({
            groupId: groups.id,
            linkId: links.id,
            createdAt: sql<Date>`now()`.as("created_at"),
          })
          .from(links)
          .innerJoin(groups, and(eq(groups.ownerId, actorId), eq(groups.kind, "starred")))
          .where(and(eq(links.id, linkId), ne(links.ownerId, actorId), linkVisible(actorId))),
      )
      .onConflictDoUpdate({ target: [stars.groupId, stars.linkId], set: { linkId } })
      .returning({ linkId: stars.linkId })
      .then((rows) => rows[0]),
    databaseError,
  );
}

export function unstarLink(db: QueryDatabase, actorId: string, linkId: string) {
  return ResultAsync.fromPromise(
    db
      .delete(stars)
      .where(
        and(
          eq(stars.linkId, linkId),
          inArray(
            stars.groupId,
            db
              .select({ id: groups.id })
              .from(groups)
              .where(and(eq(groups.ownerId, actorId), eq(groups.kind, "starred"))),
          ),
        ),
      )
      .then(() => ({ success: true as const })),
    databaseError,
  );
}
