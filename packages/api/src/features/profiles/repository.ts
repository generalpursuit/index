import { follows, links } from "@index/db/schema/app";
import { user } from "@index/db/schema/auth";
import { and, eq, inArray, lte, sql, type SQL } from "drizzle-orm";
import { okAsync, ResultAsync } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { linkVisible, profileContentVisible } from "../../data-access/visibility";
import { databaseError, type ApplicationError } from "../../errors";
import type { FollowedBy, UpdateProfileInput } from "./schemas";

export const publicUserSelection = {
  id: user.id,
  name: user.name,
  username: user.username,
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
        >`case when "user".id = ${viewerId} or "user".profile_visibility = 'public'
          then (select count(*)::int from ${links} where ${links.ownerId} = "user".id and ${linkVisible(viewerId)})
          else null end`,
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

export function updateProfile(
  db: QueryDatabase,
  actorId: string,
  // Uploads set an address of the store's own; everyone else may only remove it.
  input: Omit<UpdateProfileInput, "image"> & { image?: string | null },
) {
  // Lock before reading the previous image. Concurrent replacements/removals must
  // clean the object they actually replaced, not an earlier service-layer snapshot.
  const previous = db
    .$with("previous_profile")
    .as(
      db
        .select({ id: user.id, image: user.image })
        .from(user)
        .where(eq(user.id, actorId))
        .for("update"),
    );
  const updated = db.$with("updated_profile").as(
    db
      .update(user)
      .set(input)
      .where(sql`${user.id} = (select id from ${previous})`)
      .returning({ id: user.id }),
  );
  const selection = { id: updated.id, previousImage: previous.image };
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
      db
        .with(previous, updated, accepted, resolved, notices)
        .select(selection)
        .from(updated)
        .innerJoin(previous, eq(previous.id, updated.id))
        .then((rows) => rows[0]),
      profileWriteError,
    );
  }
  return ResultAsync.fromPromise(
    db
      .with(previous, updated)
      .select(selection)
      .from(updated)
      .innerJoin(previous, eq(previous.id, updated.id))
      .then((rows) => rows[0]),
    profileWriteError,
  );
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

const nobody: FollowedBy = { users: [], total: 0 };

/**
 * For each owner: up to two people the viewer follows who follow them too, and how many there
 * are in all. One query for a whole page of people.
 */
export function followedByMany(db: QueryDatabase, viewerId: string | null, ownerIds: string[]) {
  if (!viewerId || ownerIds.length === 0) return okAsync(new Map<string, FollowedBy>());
  const ranked = db
    .select({
      ...publicUserSelection,
      ownerId: sql<string>`${follows.followedId}`.as("owner_id"),
      total: sql<number>`count(*) over (partition by ${follows.followedId})::int`.as("total"),
      rank: sql<number>`row_number() over (partition by ${follows.followedId} order by ${user.id})`.as(
        "rank",
      ),
    })
    .from(user)
    .innerJoin(
      follows,
      and(
        eq(follows.followerId, user.id),
        inArray(follows.followedId, ownerIds),
        eq(follows.status, "accepted"),
      ),
    )
    .where(
      sql`exists(select 1 from follows mine where mine.follower_id = ${viewerId} and mine.followed_id = ${user.id} and mine.status='accepted')`,
    )
    .as("ranked");
  return ResultAsync.fromPromise(
    db
      .select()
      .from(ranked)
      .where(lte(ranked.rank, 2))
      .orderBy(ranked.ownerId, ranked.rank)
      .then((rows) => {
        const byOwner = new Map<string, FollowedBy>();
        for (const { ownerId, total, rank: _rank, ...person } of rows) {
          const context = byOwner.get(ownerId) ?? { users: [], total };
          context.users.push(person);
          byOwner.set(ownerId, context);
        }
        return byOwner;
      }),
    databaseError,
  );
}

export const followedBy = (db: QueryDatabase, viewerId: string | null, ownerId: string) =>
  followedByMany(db, viewerId, [ownerId]).map((byOwner) => byOwner.get(ownerId) ?? nobody);

/** Adds `followedBy` to each person, as seen by the viewer. */
export const withFollowedBy = <T extends { id: string }>(
  db: QueryDatabase,
  viewerId: string | null,
  people: T[],
) =>
  followedByMany(
    db,
    viewerId,
    people.map((person) => person.id),
  ).map((byOwner) =>
    people.map((person) => ({ ...person, followedBy: byOwner.get(person.id) ?? nobody })),
  );
