import { err, ok, okAsync, ResultAsync } from "neverthrow";

import type { QueryDatabase } from "../../data-access/database";
import { notFound } from "../../errors";
import { findOwnedCustomGroup } from "../groups/repository";
import { getGroup } from "../groups/service";
import { decodeCursor, toPage } from "../../pagination";
import {
  findVisibleLink,
  insertLink,
  listOwnedLinks,
  updateOwnedLink,
  deleteOwnedLink,
  listGroupLinks,
  listOwnerLinks,
} from "./repository";
import { readLinkMetadata, type FetchPage } from "./metadata";
import type { CreateLinkInput, Link, ListMyLinksInput, UpdateLinkInput } from "./schemas";

const readMetadata = (url: string, fetchPage: FetchPage) =>
  ResultAsync.fromSafePromise(readLinkMetadata(url, fetchPage));

/** The page decides the category; it also supplies the title when none was given. */
export function createLink(
  db: QueryDatabase,
  actorId: string,
  input: CreateLinkInput,
  fetchPage: FetchPage,
) {
  const save = () =>
    readMetadata(input.url, fetchPage).andThen((metadata) =>
      insertLink(db, {
        url: input.url,
        title: input.title ?? metadata.title,
        description: input.description ?? null,
        category: metadata.category,
        ownerId: actorId,
        groupId: input.groupId ?? null,
      }),
    );
  return input.groupId
    ? findOwnedCustomGroup(db, actorId, input.groupId)
        .andThen((group) => (group ? ok(group) : err(notFound("Group"))))
        .andThen(save)
    : save();
}

export function getLink(db: QueryDatabase, actorId: string | null, id: string) {
  return findVisibleLink(db, actorId, id).andThen((link) =>
    link ? ok(link) : err({ code: "NOT_FOUND" as const, message: "Link not found." }),
  );
}

export function listMyLinks(db: QueryDatabase, actorId: string, input: ListMyLinksInput) {
  const cursor = input.cursor ? decodeCursor(input.cursor) : ok(undefined);
  return cursor.asyncAndThen((decoded) =>
    listOwnedLinks(db, actorId, input.limit + 1, decoded, input).map((rows) =>
      toPage(rows, input.limit),
    ),
  );
}

/** A new URL may point at a different kind of page, so its category is read again. */
export function updateLink(
  db: QueryDatabase,
  actorId: string,
  input: UpdateLinkInput,
  fetchPage: FetchPage,
) {
  const category: ResultAsync<Link["category"] | undefined, never> = input.url
    ? readMetadata(input.url, fetchPage).map((metadata) => metadata.category)
    : okAsync(undefined);
  return category
    .andThen((category) => updateOwnedLink(db, actorId, { ...input, category }))
    .andThen((link) => (link ? ok(link) : err(notFound("Link or destination group"))));
}

export const deleteLink = (db: QueryDatabase, actorId: string, id: string) =>
  deleteOwnedLink(db, actorId, id).andThen((link) =>
    link ? ok({ success: true as const }) : err(notFound("Link")),
  );

export function listInGroup(
  db: QueryDatabase,
  viewerId: string | null,
  input: { groupId: string; limit: number; cursor?: string; weekStart?: string },
) {
  const cursor = input.cursor ? decodeCursor(input.cursor) : ok(undefined);
  return cursor.asyncAndThen((decoded) =>
    ResultAsync.combine([
      getGroup(db, viewerId, input.groupId),
      listGroupLinks(db, viewerId, input.groupId, input.limit + 1, decoded, input.weekStart),
    ]).map(([, rows]) => toPage(rows, input.limit)),
  );
}

export function listByOwner(
  db: QueryDatabase,
  viewerId: string | null,
  input: { userId: string; limit: number; cursor?: string; weekStart?: string },
) {
  const cursor = input.cursor ? decodeCursor(input.cursor) : ok(undefined);
  return cursor.asyncAndThen((decoded) =>
    listOwnerLinks(db, viewerId, input.userId, input.limit + 1, decoded, input.weekStart).map(
      (rows) => toPage(rows, input.limit),
    ),
  );
}

export { libraryWeeks } from "./repository";
