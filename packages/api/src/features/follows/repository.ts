import { follows } from "@index/db/schema/app";
import { user } from "@index/db/schema/auth";
import { and, asc, eq, gt, ne, sql } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { profileContentVisible } from "../../data-access/visibility";
import { databaseError } from "../../errors";
import { publicUserSelection } from "../profiles/repository";

export function followUser(db: QueryDatabase, actorId: string, targetId: string) {
  return ResultAsync.fromPromise(
    db
      .insert(follows)
      .select(
        db
          .select({
            followerId: sql<string>`${actorId}`.as("follower_id"),
            followedId: user.id,
            status: sql<
              "pending" | "accepted"
            >`case when ${user.profileVisibility} = 'public' then 'accepted' else 'pending' end`.as(
              "status",
            ),
            createdAt: sql<Date>`now()`.as("created_at"),
            acceptedAt:
              sql<Date | null>`case when ${user.profileVisibility} = 'public' then now() else null end`.as(
                "accepted_at",
              ),
          })
          .from(user)
          .where(and(eq(user.id, targetId), ne(user.id, actorId))),
      )
      .onConflictDoUpdate({
        target: [follows.followerId, follows.followedId],
        set: { followerId: actorId },
      })
      .returning({ status: follows.status })
      .then((rows) => rows[0]),
    databaseError,
  );
}

export function removeFollow(
  db: QueryDatabase,
  followerId: string,
  followedId: string,
  pendingOnly = false,
) {
  return ResultAsync.fromPromise(
    db
      .delete(follows)
      .where(
        and(
          eq(follows.followerId, followerId),
          eq(follows.followedId, followedId),
          pendingOnly ? eq(follows.status, "pending") : undefined,
        ),
      )
      .then(() => ({ success: true as const })),
    databaseError,
  );
}

export function acceptFollow(db: QueryDatabase, actorId: string, followerId: string) {
  return ResultAsync.fromPromise(
    db
      .update(follows)
      .set({ status: "accepted", acceptedAt: sql`coalesce(${follows.acceptedAt}, now())` })
      .where(and(eq(follows.followedId, actorId), eq(follows.followerId, followerId)))
      .returning({ status: follows.status })
      .then((rows) => rows[0]),
    databaseError,
  );
}

export function listNetwork(
  db: QueryDatabase,
  viewerId: string | null,
  userId: string,
  direction: "followers" | "following" | "requests",
  limit: number,
  after?: string,
) {
  const incoming = direction !== "following";
  return ResultAsync.fromPromise(
    db
      .select(publicUserSelection)
      .from(follows)
      .innerJoin(user, eq(user.id, incoming ? follows.followerId : follows.followedId))
      .where(
        and(
          eq(incoming ? follows.followedId : follows.followerId, userId),
          eq(follows.status, direction === "requests" ? "pending" : "accepted"),
          profileContentVisible(viewerId, sql`${userId}`),
          direction === "requests" ? sql`${userId} = ${viewerId}` : undefined,
          after ? gt(user.id, after) : undefined,
        ),
      )
      .orderBy(asc(user.id))
      .limit(limit),
    databaseError,
  );
}
