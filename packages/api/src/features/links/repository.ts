import { links } from "@index/db/schema/app";
import { and, desc, eq, sql } from "drizzle-orm";
import { ResultAsync } from "neverthrow";

import type { QueryDatabase } from "../../data-access/database";
import { databaseError } from "../../errors";
import type { LinkCursor } from "./cursor";

const selection = {
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
      .returning(selection)
      .then((rows) => {
        const created = rows[0];
        if (!created) throw new Error("Inserting a link returned no row.");
        return created;
      }),
    databaseError,
  );
}

export function findOwnedLink(db: QueryDatabase, ownerId: string, id: string) {
  return ResultAsync.fromPromise(
    db
      .select(selection)
      .from(links)
      .where(and(eq(links.ownerId, ownerId), eq(links.id, id)))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    databaseError,
  );
}

export function listOwnedLinks(
  db: QueryDatabase,
  ownerId: string,
  limit: number,
  cursor?: LinkCursor,
) {
  return ResultAsync.fromPromise(
    db
      .select(selection)
      .from(links)
      .where(
        and(
          eq(links.ownerId, ownerId),
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
