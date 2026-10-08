import { follows } from "@index/db/schema/app";
import { user } from "@index/db/schema/auth";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { profileContentVisible } from "../../data-access/visibility";
import { databaseError, type ApplicationError } from "../../errors";
import type { UpdateProfileInput } from "./schemas";

export const publicUserSelection = {
  id: user.id,
  name: user.name,
  username: user.username,
  bio: user.bio,
  image: user.image,
  profileVisibility: user.profileVisibility,
};

export function findProfile(db: QueryDatabase, viewerId: string | null, filter: SQL) {
  return ResultAsync.fromPromise(
    db
      .select({
        ...publicUserSelection,
        followerCount: sql<
          number | null
        >`case when "user".id = ${viewerId} then (select count(*)::int from follows f where f.followed_id = "user".id and f.status = 'accepted') else null end`,
        followingCount: sql<
          number | null
        >`case when "user".id = ${viewerId} then (select count(*)::int from follows f where f.follower_id = "user".id and f.status = 'accepted') else null end`,
        linkCount: sql<
          number | null
        >`case when "user".id = ${viewerId} then (select count(*)::int from links l where l.owner_id = "user".id) when "user".profile_visibility = 'public' then (select count(*)::int from links l join groups g on g.id=l.group_id where l.owner_id="user".id and g.visibility='public' and g.kind='custom') else null end`,
        // Keep the outer reference qualified inside the correlated subquery. Drizzle
        // otherwise unqualifies selected columns, which can bind to the inner user.
        canViewContent: profileContentVisible(viewerId, sql`"user"."id"`),
        followingStatus: sql<
          "pending" | "accepted" | null
        >`(select status from follows where follower_id = ${viewerId} and followed_id = "user"."id")`,
      })
      .from(user)
      .where(filter)
      .limit(1)
      .then((rows) => rows[0]),
    databaseError,
  );
}

export function updateProfile(db: QueryDatabase, actorId: string, input: UpdateProfileInput) {
  const updated = db
    .$with("updated_profile")
    .as(db.update(user).set(input).where(eq(user.id, actorId)).returning({ id: user.id }));
  if (input.profileVisibility === "public") {
    // Profile publication and pending-request acceptance are one atomic statement.
    const accepted = db.$with("accepted_requests").as(
      db
        .update(follows)
        .set({ status: "accepted", acceptedAt: sql`now()` })
        .where(
          and(
            eq(follows.followedId, actorId),
            eq(follows.status, "pending"),
            sql`exists (select 1 from ${updated})`,
          ),
        )
        .returning({ followerId: follows.followerId }),
    );
    const resolved = db.$with("resolved_requests", {}).as(sql`
      update activities a set request_status='accepted' from accepted_requests r
      where a.type='request' and a.request_status='pending' and a.recipient_id=${actorId} and a.actor_id=r.follower_id returning a.id`);
    const notices = db.$with("acceptance_notices", {}).as(sql`
      insert into activities(recipient_id,actor_id,type) select follower_id,${actorId},'accepted' from accepted_requests returning id`);
    return ResultAsync.fromPromise(
      db.with(updated, accepted, resolved, notices).select().from(updated),
      profileWriteError,
    );
  }
  return ResultAsync.fromPromise(db.with(updated).select().from(updated), profileWriteError);
}

function profileWriteError(cause: unknown): ApplicationError {
  // Drizzle wraps driver errors; inspect only the PostgreSQL error code.
  const driverError = cause && typeof cause === "object" && "cause" in cause ? cause.cause : cause;
  if (
    driverError &&
    typeof driverError === "object" &&
    "code" in driverError &&
    driverError.code === "23505"
  ) {
    return { code: "CONFLICT", message: "That username is already taken." };
  }
  return databaseError(cause);
}

export function followedBy(db: QueryDatabase, viewerId: string | null, ownerId: string) {
  return ResultAsync.fromPromise(
    db
      .select({ ...publicUserSelection, total: sql<number>`count(*) over()::int` })
      .from(user)
      .innerJoin(
        follows,
        and(
          eq(follows.followerId, user.id),
          eq(follows.followedId, ownerId),
          eq(follows.status, "accepted"),
        ),
      )
      .where(
        sql`exists(select 1 from follows mine where mine.follower_id = ${viewerId} and mine.followed_id = ${user.id} and mine.status='accepted')`,
      )
      .orderBy(user.id)
      .limit(2)
      .then((rows) => ({
        users: rows.map(({ total: _total, ...person }) => person),
        total: rows[0]?.total ?? 0,
      })),
    databaseError,
  );
}
