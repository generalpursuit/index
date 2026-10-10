import { activities, comments } from "@index/db/schema/app";
import { user } from "@index/db/schema/auth";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { timestamp } from "../../data-access/timestamp";
import { linkVisible } from "../../data-access/visibility";
import { databaseError } from "../../errors";
import type { Cursor } from "../../pagination";
import { publicUserSelection } from "../profiles/repository";
const visible = (actorId: string) =>
  and(
    eq(activities.recipientId, actorId),
    sql`(${activities.type} not in ('comment','mention') or exists(select 1 from links where links.id=${activities.linkId} and ${linkVisible(actorId)}))`,
  );
export function listActivity(
  db: QueryDatabase,
  actorId: string,
  limit: number,
  cursor?: Cursor,
  type?: typeof activities.$inferSelect.type,
) {
  return ResultAsync.fromPromise(
    db
      .select({
        id: activities.id,
        type: activities.type,
        actor: publicUserSelection,
        createdAt: timestamp(activities.createdAt),
        readAt: timestamp(activities.readAt),
        linkId: activities.linkId,
        linkShortId: sql<
          string | null
        >`(select short_id from links where links.id=${activities.linkId})`,
        commentId: activities.commentId,
        body: comments.body,
        requestStatus: activities.requestStatus,
      })
      .from(activities)
      .innerJoin(user, eq(user.id, activities.actorId))
      .leftJoin(comments, eq(comments.id, activities.commentId))
      .where(
        and(
          visible(actorId),
          type ? eq(activities.type, type) : undefined,
          cursor
            ? sql`(${activities.createdAt},${activities.id}) < (${cursor.createdAt}::timestamptz,${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(activities.createdAt), desc(activities.id))
      .limit(limit),
    databaseError,
  );
}
export function unreadCount(db: QueryDatabase, actorId: string) {
  return ResultAsync.fromPromise(
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(activities)
      .where(and(visible(actorId), isNull(activities.readAt)))
      .then((rows) => rows[0]!.count),
    databaseError,
  );
}
export function markRead(db: QueryDatabase, actorId: string, ids: string[]) {
  return ResultAsync.fromPromise(
    db
      .update(activities)
      .set({ readAt: sql`coalesce(${activities.readAt},now())` })
      .where(and(eq(activities.recipientId, actorId), inArray(activities.id, ids)))
      .then(() => ({ success: true as const })),
    databaseError,
  );
}
