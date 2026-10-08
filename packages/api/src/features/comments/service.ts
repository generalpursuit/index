import { err, ok } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { notFound } from "../../errors";
import { decodeCursor, toPage } from "../../pagination";
import { getLink } from "../links/service";
import * as repository from "./repository";

export const createComment = (db: QueryDatabase, actorId: string, linkId: string, body: string) =>
  repository
    .createComment(db, actorId, linkId, body)
    .andThen((comment) => (comment ? ok(comment) : err(notFound("Link"))));
export const updateComment = (db: QueryDatabase, actorId: string, id: string, body: string) =>
  repository
    .updateComment(db, actorId, id, body)
    .andThen((comment) => (comment ? ok(comment) : err(notFound("Comment"))));
export const deleteComment = (db: QueryDatabase, actorId: string, id: string) =>
  repository
    .deleteComment(db, actorId, id)
    .andThen((comment) => (comment ? ok({ success: true as const }) : err(notFound("Comment"))));

export function listComments(
  db: QueryDatabase,
  viewerId: string | null,
  input: { linkId: string; limit: number; cursor?: string },
) {
  const cursor = input.cursor ? decodeCursor(input.cursor) : ok(undefined);
  return cursor.asyncAndThen((decoded) =>
    getLink(db, viewerId, input.linkId)
      .andThen(() => repository.listComments(db, viewerId, input.linkId, input.limit + 1, decoded))
      .map((rows) => toPage(rows, input.limit)),
  );
}
