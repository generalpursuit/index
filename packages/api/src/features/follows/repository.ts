import { follows } from "@index/db/schema/app";
import { user } from "@index/db/schema/auth";
import { and, asc, eq, gt, ilike, ne, or, sql } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { databaseError } from "../../errors";
import { publicUserSelection } from "../profiles/repository";

export function followUser(db: QueryDatabase, actorId: string, targetId: string) {
  const changed = db.$with("changed_follow").as(
    db
      .insert(follows)
      .select(
        db
          .select({
            followerId: sql<string>`${actorId}`.as("follower_id"),
            followedId: user.id,
            status: sql<
              "pending" | "accepted"
            >`case when ${user.profileVisibility}='public' then 'accepted' else 'pending' end`.as(
              "status",
            ),
            createdAt: sql<Date>`now()`.as("created_at"),
            acceptedAt:
              sql<Date | null>`case when ${user.profileVisibility}='public' then now() else null end`.as(
                "accepted_at",
              ),
          })
          .from(user)
          .where(and(eq(user.id, targetId), ne(user.id, actorId))),
      )
      .onConflictDoNothing()
      .returning(),
  );
  const notice = db.$with("follow_notice", {}).as(sql`
 insert into activities(recipient_id,actor_id,type,request_status)
 select followed_id,follower_id,case when status='pending' then 'request' else 'follow' end,
 case when status='pending' then 'pending' else null end from changed_follow returning id`);
  return ResultAsync.fromPromise(
    db
      .with(changed, notice)
      .select({ status: changed.status })
      .from(changed)
      .then(
        async (rows) =>
          rows[0] ??
          (
            await db
              .select({ status: follows.status })
              .from(follows)
              .where(and(eq(follows.followerId, actorId), eq(follows.followedId, targetId)))
              .limit(1)
          )[0],
      ),
    databaseError,
  );
}
export function removeFollow(
  db: QueryDatabase,
  followerId: string,
  followedId: string,
  pendingOnly = false,
) {
  const removed = db.$with("removed_follow").as(
    db
      .delete(follows)
      .where(
        and(
          eq(follows.followerId, followerId),
          eq(follows.followedId, followedId),
          pendingOnly ? eq(follows.status, "pending") : undefined,
        ),
      )
      .returning(),
  );
  const notice = db.$with("resolved_request", {}).as(sql`
 update activities a set request_status=${pendingOnly ? "declined" : "canceled"}
 from removed_follow r where a.type='request' and a.request_status='pending' and a.actor_id=r.follower_id and a.recipient_id=r.followed_id returning a.id`);
  return ResultAsync.fromPromise(
    db
      .with(removed, notice)
      .select({ id: removed.followerId })
      .from(removed)
      .then(() => ({ success: true as const })),
    databaseError,
  );
}
export function acceptFollow(db: QueryDatabase, actorId: string, followerId: string) {
  const accepted = db.$with("accepted_follow").as(
    db
      .update(follows)
      .set({ status: "accepted", acceptedAt: sql`now()` })
      .where(
        and(
          eq(follows.followedId, actorId),
          eq(follows.followerId, followerId),
          eq(follows.status, "pending"),
        ),
      )
      .returning(),
  );
  const resolved = db
    .$with("resolved_request", {})
    .as(
      sql`update activities a set request_status='accepted' from accepted_follow r where a.type='request' and a.request_status='pending' and a.actor_id=r.follower_id and a.recipient_id=r.followed_id returning a.id`,
    );
  const notice = db
    .$with("acceptance_notice", {})
    .as(
      sql`insert into activities(recipient_id,actor_id,type) select follower_id,followed_id,'accepted' from accepted_follow returning id`,
    );
  return ResultAsync.fromPromise(
    db
      .with(accepted, resolved, notice)
      .select({ status: accepted.status })
      .from(accepted)
      .then(
        async (rows) =>
          rows[0] ??
          (
            await db
              .select({ status: follows.status })
              .from(follows)
              .where(
                and(
                  eq(follows.followedId, actorId),
                  eq(follows.followerId, followerId),
                  eq(follows.status, "accepted"),
                ),
              )
              .limit(1)
          )[0],
      ),
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
  query?: string,
) {
  const pattern = query ? `%${query.replace(/[\\%_]/g, "\\$&")}%` : undefined;
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
          sql`${userId} = ${viewerId}`,
          eq(user.isDiscoverable, true),
          after ? gt(user.id, after) : undefined,
          pattern ? or(ilike(user.name, pattern), ilike(user.username, pattern)) : undefined,
        ),
      )
      .orderBy(asc(user.id))
      .limit(limit),
    databaseError,
  );
}
