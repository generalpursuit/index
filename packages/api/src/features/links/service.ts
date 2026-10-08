import { err, ok } from "neverthrow";

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
} from "./repository";
import type { CreateLinkInput, ListMyLinksInput, UpdateLinkInput } from "./schemas";

export function createLink(db: QueryDatabase, actorId: string, input: CreateLinkInput) {
  const save = () =>
    insertLink(db, {
      url: input.url,
      title: input.title,
      description: input.description ?? null,
      category: input.category,
      ownerId: actorId,
      groupId: input.groupId ?? null,
    });
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

export const updateLink = (db: QueryDatabase, actorId: string, input: UpdateLinkInput) =>
  updateOwnedLink(db, actorId, input).andThen((link) =>
    link ? ok(link) : err(notFound("Link or destination group")),
  );

export const deleteLink = (db: QueryDatabase, actorId: string, id: string) =>
  deleteOwnedLink(db, actorId, id).andThen((link) =>
    link ? ok({ success: true as const }) : err(notFound("Link")),
  );

export function listInGroup(
  db: QueryDatabase,
  viewerId: string | null,
  input: { groupId: string; limit: number; cursor?: string },
) {
  const cursor = input.cursor ? decodeCursor(input.cursor) : ok(undefined);
  return cursor.asyncAndThen((decoded) =>
    getGroup(db, viewerId, input.groupId)
      .andThen(() => listGroupLinks(db, viewerId, input.groupId, input.limit + 1, decoded))
      .map((rows) => toPage(rows, input.limit)),
  );
}
