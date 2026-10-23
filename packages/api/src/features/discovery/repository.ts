import { follows } from "@index/db/schema/app";
import { user } from "@index/db/schema/auth";
import { and, asc, desc, eq, gt, ilike, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ResultAsync } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { profileContentVisible } from "../../data-access/visibility";
import { databaseError } from "../../errors";
import { publicUserSelection } from "../profiles/repository";

export function searchUsers(
  db: QueryDatabase,
  viewerId: string | null,
  query: string,
  limit: number,
  after?: string,
) {
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  return ResultAsync.fromPromise(
    db
      .select({
        ...publicUserSelection,
        followingStatus: sql<
          "pending" | "accepted" | null
        >`(select status from follows where follower_id = ${viewerId} and followed_id = ${user.id})`,
      })
      .from(user)
      .where(
        and(
          eq(user.isDiscoverable, true),
          or(ilike(user.username, pattern), ilike(user.name, pattern)),
          after ? gt(user.id, after) : undefined,
        ),
      )
      .orderBy(asc(user.id))
      .limit(limit),
    databaseError,
  );
}

export function recommendations(db: QueryDatabase, actorId: string, limit: number) {
  const mine = alias(follows, "my_follows");
  const theirs = alias(follows, "their_follows");
  const recommender = alias(user, "recommender");
  const mutualCount = sql<number>`count(distinct ${mine.followedId})::integer`;
  return ResultAsync.fromPromise(
    db
      .select({
        ...publicUserSelection,
        followingStatus: sql<null>`null`,
      })
      .from(mine)
      .innerJoin(theirs, eq(theirs.followerId, mine.followedId))
      .innerJoin(recommender, eq(recommender.id, mine.followedId))
      .innerJoin(user, eq(user.id, theirs.followedId))
      .where(
        and(
          eq(mine.followerId, actorId),
          eq(mine.status, "accepted"),
          eq(theirs.status, "accepted"),
          eq(recommender.isDiscoverable, true),
          eq(user.isDiscoverable, true),
          profileContentVisible(actorId, mine.followedId),
          ne(user.id, actorId),
          sql`not exists (select 1 from follows existing where existing.follower_id = ${actorId} and existing.followed_id = ${user.id})`,
        ),
      )
      .groupBy(user.id)
      .orderBy(desc(mutualCount), asc(user.id))
      .limit(limit),
    databaseError,
  );
}
