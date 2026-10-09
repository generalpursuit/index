import { follows, links } from "@index/db/schema/app";
import { user } from "@index/db/schema/auth";
import { and, asc, desc, eq, gt, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { linkVisible } from "../../data-access/visibility";
import { databaseError } from "../../errors";
import type { Cursor } from "../../pagination";
import { linkSelection, collectionSelection, inWeek } from "../links/repository";
import { publicUserSelection } from "../profiles/repository";

export function listFeed(db: QueryDatabase, actorId: string, limit: number, cursor?: Cursor) {
  return ResultAsync.fromPromise(
    db
      .select({ ...linkSelection, ...collectionSelection(actorId), author: publicUserSelection })
      .from(links)
      .innerJoin(user, eq(user.id, links.ownerId))
      .innerJoin(
        follows,
        and(
          eq(follows.followedId, links.ownerId),
          eq(follows.followerId, actorId),
          eq(follows.status, "accepted"),
        ),
      )
      .where(
        and(
          linkVisible(actorId),
          cursor
            ? sql`(${links.createdAt}, ${links.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(links.createdAt), desc(links.id))
      .limit(limit),
    databaseError,
  );
}

export function weekAuthors(
  db: QueryDatabase,
  actorId: string,
  weekStart: string,
  limit: number,
  after?: string,
) {
  return ResultAsync.fromPromise(
    db
      .select(publicUserSelection)
      .from(user)
      .innerJoin(
        follows,
        and(
          eq(follows.followedId, user.id),
          eq(follows.followerId, actorId),
          eq(follows.status, "accepted"),
        ),
      )
      .where(
        and(
          after ? gt(user.id, after) : undefined,
          sql`exists (${db
            .select({ id: links.id })
            .from(links)
            .where(and(eq(links.ownerId, user.id), inWeek(weekStart), linkVisible(actorId)))})`,
        ),
      )
      .orderBy(asc(user.id))
      .limit(limit),
    databaseError,
  );
}

/** Links from the viewer or people they follow (accepted), as far as the viewer may see them. */
const fromHome = (actorId: string) =>
  and(
    or(
      eq(links.ownerId, actorId),
      sql`exists (select 1 from ${follows} where ${follows.followerId} = ${actorId} and ${follows.followedId} = ${links.ownerId} and ${follows.status} = 'accepted')`,
    ),
    linkVisible(actorId),
  );

/** Weeks with such links and how many, newest first. */
export function homeWeeks(
  db: QueryDatabase,
  actorId: string,
  input: { before?: string; limit: number },
) {
  const week = sql<string>`to_char(date_trunc('week',${links.savedOn}::timestamp),'YYYY-MM-DD')`;
  return ResultAsync.fromPromise(
    db
      .select({ weekStart: week, count: sql<number>`count(*)::int` })
      .from(links)
      .where(
        and(
          fromHome(actorId),
          input.before ? sql`${links.savedOn} < ${input.before}::date` : undefined,
        ),
      )
      .groupBy(week)
      .orderBy(desc(week))
      .limit(input.limit + 1)
      .then((rows) => ({
        items: rows.slice(0, input.limit),
        nextBefore: rows.length > input.limit ? rows[input.limit - 1]!.weekStart : null,
      })),
    databaseError,
  );
}

/** The nearest weeks before and after `weekStart` with links from the viewer or people they follow. */
export function neighborWeeks(db: QueryDatabase, actorId: string, weekStart: string) {
  const monday = (date: SQL) =>
    sql<string | null>`to_char(date_trunc('week', (${date})::timestamp), 'YYYY-MM-DD')`;
  return ResultAsync.fromPromise(
    db
      .select({
        older: monday(
          sql`max(${links.savedOn}) filter (where ${links.savedOn} < ${weekStart}::date)`,
        ),
        newer: monday(
          sql`min(${links.savedOn}) filter (where ${links.savedOn} >= ${weekStart}::date + 7)`,
        ),
      })
      .from(links)
      .where(fromHome(actorId))
      .then((rows) => rows[0]!),
    databaseError,
  );
}

/** One bounded page per author, including the viewer, in a single database request. */
export function weekLinks(
  db: QueryDatabase,
  viewerId: string,
  ownerIds: string[],
  weekStart: string,
  limit: number,
) {
  const collected = collectionSelection(viewerId);
  const ranked = db
    .select({
      ...linkSelection,
      createdAt: linkSelection.createdAt.as("created_at"),
      updatedAt: linkSelection.updatedAt.as("updated_at"),
      isFavorite: collected.isFavorite.as("is_favorite"),
      isStarred: collected.isStarred.as("is_starred"),
      rank: sql<number>`row_number() over (partition by ${links.ownerId} order by ${links.createdAt} desc, ${links.id} desc)`.as(
        "rank",
      ),
    })
    .from(links)
    .where(and(inArray(links.ownerId, ownerIds), inWeek(weekStart), linkVisible(viewerId)))
    .as("ranked_links");
  return ResultAsync.fromPromise(
    db
      .select()
      .from(ranked)
      .where(lte(ranked.rank, limit + 1))
      .orderBy(asc(ranked.ownerId), asc(ranked.rank))
      .then((rows) => rows.map(({ rank: _rank, ...link }) => link)),
    databaseError,
  );
}
