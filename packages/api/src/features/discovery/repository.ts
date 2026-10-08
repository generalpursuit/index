import { follows } from "@index/db/schema/app";
import { user } from "@index/db/schema/auth";
import { and, asc, desc, eq, gt, ilike, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ResultAsync } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { profileContentVisible } from "../../data-access/visibility";
import { databaseError } from "../../errors";
import { publicUserSelection } from "../profiles/repository";

export function searchUsers(db: QueryDatabase, query: string, limit: number, after?: string) {
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  return ResultAsync.fromPromise(
    db
      .select(publicUserSelection)
      .from(user)
      .where(
        and(
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
  const mutualCount = sql<number>`count(distinct ${mine.followedId})::integer`;
  return ResultAsync.fromPromise(
    db
      .select({ ...publicUserSelection, mutualCount })
      .from(mine)
      .innerJoin(theirs, eq(theirs.followerId, mine.followedId))
      .innerJoin(user, eq(user.id, theirs.followedId))
      .where(
        and(
          eq(mine.followerId, actorId),
          eq(mine.status, "accepted"),
          eq(theirs.status, "accepted"),
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
