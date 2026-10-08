import { groups, links } from "@index/db/schema/app";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { timestamp } from "../../data-access/timestamp";
import { groupVisible } from "../../data-access/visibility";
import { databaseError } from "../../errors";
import type { Cursor } from "../../pagination";
import type { CreateGroupInput, UpdateGroupInput } from "./schemas";

export const groupSelection = {
  id: groups.id,
  ownerId: groups.ownerId,
  name: groups.name,
  kind: groups.kind,
  visibility: groups.visibility,
  createdAt: timestamp(groups.createdAt),
  updatedAt: timestamp(groups.updatedAt),
};

export function insertGroup(db: QueryDatabase, ownerId: string, input: CreateGroupInput) {
  return ResultAsync.fromPromise(
    db
      .insert(groups)
      .values({ ...input, ownerId, kind: "custom" })
      .returning(groupSelection)
      .then((rows) => rows[0]),
    databaseError,
  );
}

export function ensureSystemGroup(
  db: QueryDatabase,
  ownerId: string,
  kind: "starred" | "favorites",
) {
  return ResultAsync.fromPromise(
    db
      .insert(groups)
      .values({ ownerId, name: kind === "starred" ? "Starred" : "Favorites", kind })
      .onConflictDoNothing()
      .then(() => undefined),
    databaseError,
  );
}

export function findGroup(db: QueryDatabase, viewerId: string | null, id: string) {
  return ResultAsync.fromPromise(
    db
      .select(groupSelection)
      .from(groups)
      .where(and(eq(groups.id, id), groupVisible(viewerId)))
      .limit(1)
      .then((rows) => rows[0]),
    databaseError,
  );
}

export function findOwnedCustomGroup(db: QueryDatabase, ownerId: string, id: string) {
  return ResultAsync.fromPromise(
    db
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.id, id), eq(groups.ownerId, ownerId), eq(groups.kind, "custom")))
      .limit(1)
      .then((rows) => rows[0]),
    databaseError,
  );
}

export function listGroups(
  db: QueryDatabase,
  viewerId: string | null,
  ownerId: string,
  limit: number,
  cursor?: Cursor,
  includeFavorites = false,
) {
  return ResultAsync.fromPromise(
    db
      .select(groupSelection)
      .from(groups)
      .where(
        and(
          eq(groups.ownerId, ownerId),
          groupVisible(viewerId),
          includeFavorites ? undefined : ne(groups.kind, "favorites"),
          cursor
            ? sql`(${groups.createdAt}, ${groups.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(groups.createdAt), desc(groups.id))
      .limit(limit),
    databaseError,
  );
}

export function updateGroup(
  db: QueryDatabase,
  ownerId: string,
  { id, ...input }: UpdateGroupInput,
) {
  return ResultAsync.fromPromise(
    db
      .update(groups)
      .set(input)
      .where(
        and(
          eq(groups.id, id),
          eq(groups.ownerId, ownerId),
          // System groups retain their names; only visibility is editable.
          input.name !== undefined ? eq(groups.kind, "custom") : undefined,
        ),
      )
      .returning(groupSelection)
      .then((rows) => rows[0]),
    databaseError,
  );
}

export function deleteGroup(db: QueryDatabase, ownerId: string, id: string, deleteLinks: boolean) {
  const ownedCustom = and(
    eq(groups.id, id),
    eq(groups.ownerId, ownerId),
    eq(groups.kind, "custom"),
  );
  const eligibleLinks = and(
    eq(links.groupId, id),
    eq(links.ownerId, ownerId),
    sql`exists (${db.select({ id: groups.id }).from(groups).where(ownedCustom)})`,
  );
  // One PostgreSQL statement makes the child changes and group deletion atomic on Neon HTTP.
  const changedLinks = db
    .$with("changed_links")
    .as(
      deleteLinks
        ? db.delete(links).where(eligibleLinks).returning({ id: links.id })
        : db.update(links).set({ groupId: null }).where(eligibleLinks).returning({ id: links.id }),
    );
  return ResultAsync.fromPromise(
    db
      .with(changedLinks)
      .delete(groups)
      .where(ownedCustom)
      .returning({ id: groups.id })
      .then((rows) => rows[0]),
    databaseError,
  );
}
