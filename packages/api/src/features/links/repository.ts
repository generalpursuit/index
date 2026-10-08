import { groups, links, stars } from "@index/db/schema/app";
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
  createdAt: sql<string>`to_char(${links.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  updatedAt: sql<string>`to_char(${links.updatedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
};

type NewLink = Pick<
  typeof links.$inferInsert,
  "ownerId" | "groupId" | "url" | "title" | "description" | "category"
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

export function findVisibleLink(db: QueryDatabase, viewerId: string | null, id: string) {
  return ResultAsync.fromPromise(
    db
      .select(linkSelection)
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
  filters?: Pick<ListMyLinksInput, "groupId" | "inbox" | "category">,
) {
  return ResultAsync.fromPromise(
    db
      .select(linkSelection)
      .from(links)
      .where(
        and(
          eq(links.ownerId, ownerId),
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
      .returning(linkSelection)
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

export function listGroupLinks(
  db: QueryDatabase,
  viewerId: string | null,
  groupId: string,
  limit: number,
  cursor?: Cursor,
) {
  // The group and the original link must both remain visible, including for Starred.
  return ResultAsync.fromPromise(
    db
      .select(linkSelection)
      .from(links)
      .innerJoin(
        groups,
        and(
          eq(groups.id, groupId),
          sql`(
      (${groups.kind} = 'custom' and ${links.groupId} = ${groups.id}) or
      (${groups.kind} = 'starred' and exists (select 1 from ${stars} where ${stars.groupId} = ${groups.id} and ${stars.linkId} = ${links.id}))
    )`,
        ),
      )
      .where(
        and(
          groupVisible(viewerId),
          linkVisible(viewerId),
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
