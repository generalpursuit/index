import { err, ok } from "neverthrow";

import type { QueryDatabase } from "../../data-access/database";
import { decodeCursor, encodeCursor } from "./cursor";
import { findOwnedLink, insertLink, listOwnedLinks } from "./repository";
import type { CreateLinkInput, ListMyLinksInput } from "./schemas";

export function createLink(db: QueryDatabase, actorId: string, input: CreateLinkInput) {
  return insertLink(db, {
    url: input.url,
    title: input.title,
    description: input.description ?? null,
    category: input.category,
    ownerId: actorId,
    groupId: null,
  });
}

export function getLink(db: QueryDatabase, actorId: string, id: string) {
  return findOwnedLink(db, actorId, id).andThen((link) =>
    link ? ok(link) : err({ code: "NOT_FOUND" as const, message: "Link not found." }),
  );
}

export function listMyLinks(db: QueryDatabase, actorId: string, input: ListMyLinksInput) {
  const cursor = input.cursor ? decodeCursor(input.cursor) : ok(undefined);
  return cursor.asyncAndThen((decoded) =>
    listOwnedLinks(db, actorId, input.limit + 1, decoded).map((rows) => {
      const items = rows.slice(0, input.limit);
      const last = items.at(-1);
      return {
        items,
        nextCursor: rows.length > input.limit && last ? encodeCursor(last) : null,
      };
    }),
  );
}
