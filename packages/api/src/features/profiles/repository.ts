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
    return ResultAsync.fromPromise(
      db.with(updated, accepted).select().from(updated),
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
