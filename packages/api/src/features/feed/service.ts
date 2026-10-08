import { ok } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { decodeCursor, toPage } from "../../pagination";
import * as repository from "./repository";

export function listFeed(
  db: QueryDatabase,
  actorId: string,
  input: { limit: number; cursor?: string },
) {
  const cursor = input.cursor ? decodeCursor(input.cursor) : ok(undefined);
  return cursor.asyncAndThen((decoded) =>
    repository
      .listFeed(db, actorId, input.limit + 1, decoded)
      .map((rows) => toPage(rows, input.limit)),
  );
}
