import { groups, links, stars, favorites } from "@index/db/schema/app";
import { and, desc, eq, sql } from "drizzle-orm";
import { ResultAsync } from "neverthrow";

import type { QueryDatabase } from "../../data-access/database";
import { groupVisible, linkVisible } from "../../data-access/visibility";
import { databaseError } from "../../errors";
import type { Cursor } from "../../pagination";
import type { ListMyLinksInput, UpdateLinkInput } from "./schemas";

export const linkSelection = {
  id: links.id,
  ownerId: links.ownerId,
  groupId: links.groupId,
  url: links.url,
  title: links.title,
  description: links.description,
  category: links.category,
  savedOn: links.savedOn,
  isFavorite: sql<boolean>`false`,
  isStarred: sql<boolean>`false`,
  createdAt: sql<string>`to_char(${links.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  updatedAt: sql<string>`to_char(${links.updatedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
};

type NewLink = Pick<
  typeof links.$inferInsert,
  "ownerId" | "groupId" | "url" | "title" | "description" | "category" | "savedOn"
>;

export function insertLink(db: QueryDatabase, link: NewLink) {
  return ResultAsync.fromPromise(
    db
      .insert(links)
      .values(link)
      .returning(linkSelection)
      .then((rows) => {
        const created = rows[0];
        if (!created) throw new Error("Inserting a link returned no row.");
        return created;
      }),
    databaseError,
  );
}

export function collectionSelection(viewerId: string | null) {
  return {
    isFavorite: sql<boolean>`exists(select 1 from favorites f where f.owner_id = ${viewerId} and f.link_id = "links"."id")`,
    isStarred: sql<boolean>`exists(select 1 from stars s join groups g on g.id = s.group_id where g.owner_id = ${viewerId} and s.link_id = "links"."id" and "links"."owner_id" <> ${viewerId})`,
  };
}
export function findVisibleLink(db: QueryDatabase, viewerId: string | null, id: string) {
  return ResultAsync.fromPromise(
    db
      .select({ ...linkSelection, ...collectionSelection(viewerId) })
      .from(links)
      .where(and(linkVisible(viewerId), eq(links.id, id)))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    databaseError,
  );
}

export function listOwnedLinks(
  db: QueryDatabase,
  ownerId: string,
  limit: number,
  cursor?: Cursor,
  filters?: Pick<ListMyLinksInput, "groupId" | "inbox" | "category" | "weekStart">,
) {
  return ResultAsync.fromPromise(
    db
      .select({ ...linkSelection, ...collectionSelection(ownerId) })
      .from(links)
      .where(
        and(
          eq(links.ownerId, ownerId),
          filters?.weekStart ? inWeek(filters.weekStart) : undefined,
          filters?.groupId ? eq(links.groupId, filters.groupId) : undefined,
          filters?.inbox ? sql`${links.groupId} is null` : undefined,
          filters?.category ? eq(links.category, filters.category) : undefined,
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

export function updateOwnedLink(
  db: QueryDatabase,
  actorId: string,
  { id, ...changes }: UpdateLinkInput,
) {
  return ResultAsync.fromPromise(
    db
      .update(links)
      .set(changes)
      .where(
        and(
          eq(links.id, id),
          eq(links.ownerId, actorId),
          changes.groupId
            ? sql`exists (select 1 from groups as destination where destination.id = ${changes.groupId}::uuid and destination.owner_id = ${actorId} and destination.kind = 'custom')`
            : undefined,
        ),
      )
      .returning({ ...linkSelection, ...collectionSelection(actorId) })
      .then((rows) => rows[0]),
    databaseError,
  );
}

export function deleteOwnedLink(db: QueryDatabase, actorId: string, id: string) {
  return ResultAsync.fromPromise(
    db
      .delete(links)
      .where(and(eq(links.id, id), eq(links.ownerId, actorId)))
      .returning({ id: links.id })
      .then((rows) => rows[0]),
    databaseError,
  );
}

function collectionContainsLink() {
  return sql`(
      (${groups.kind} = 'custom' and ${links.groupId} = ${groups.id}) or
      (${groups.kind} = 'starred' and ${links.ownerId} <> ${groups.ownerId} and exists (select 1 from ${stars} where ${stars.groupId} = ${groups.id} and ${stars.linkId} = ${links.id})) or
      (${groups.kind} = 'favorites' and exists (select 1 from ${favorites} where ${favorites.ownerId} = ${groups.ownerId} and ${favorites.linkId} = ${links.id}))
    )`;
}

export function listGroupLinks(
  db: QueryDatabase,
  viewerId: string | null,
  groupId: string,
  limit: number,
  cursor?: Cursor,
  weekStart?: string,
) {
  // The group and the original link must both remain visible, including for Starred.
  return ResultAsync.fromPromise(
    db
      .select({ ...linkSelection, ...collectionSelection(viewerId) })
      .from(links)
      .innerJoin(groups, and(eq(groups.id, groupId), collectionContainsLink()))
      .where(
        and(
          groupVisible(viewerId),
          linkVisible(viewerId),
          weekStart ? inWeek(weekStart) : undefined,
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

export function inWeek(weekStart: string) {
  return sql`${links.savedOn} >= ${weekStart}::date and ${links.savedOn} < (${weekStart}::date + interval '1 week')`;
}
export function listOwnerLinks(
  db: QueryDatabase,
  viewerId: string | null,
  ownerId: string,
  limit: number,
  cursor?: Cursor,
  weekStart?: string,
) {
  return ResultAsync.fromPromise(
    db
      .select({ ...linkSelection, ...collectionSelection(viewerId) })
      .from(links)
      .where(
        and(
          eq(links.ownerId, ownerId),
          linkVisible(viewerId),
          weekStart ? inWeek(weekStart) : undefined,
          cursor
            ? sql`(${links.createdAt},${links.id}) < (${cursor.createdAt}::timestamptz,${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(links.createdAt), desc(links.id))
      .limit(limit),
    databaseError,
  );
}

export function libraryWeeks(
  db: QueryDatabase,
  viewerId: string | null,
  input: { userId: string; groupId?: string; inbox?: boolean; before?: string; limit: number },
) {
  const week = sql<string>`to_char(date_trunc('week',${links.savedOn}::timestamp),'YYYY-MM-DD')`;
  const groupMatches = input.groupId
    ? sql`exists (
   select 1 from groups where groups.id=${input.groupId}::uuid and groups.owner_id=${input.userId} and ${groupVisible(viewerId)} and ${collectionContainsLink()}
   )`
    : eq(links.ownerId, input.userId);
  return ResultAsync.fromPromise(
    db
      .select({ weekStart: week, count: sql<number>`count(*)::int` })
      .from(links)
      .where(
        and(
          groupMatches,
          linkVisible(viewerId),
          input.inbox ? sql`links.group_id is null` : undefined,
          input.before ? sql`${links.savedOn}<${input.before}::date` : undefined,
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
