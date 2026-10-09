import { ok } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { decodeCursor, toPage } from "../../pagination";
import * as repository from "./repository";
export function listActivity(
  db: QueryDatabase,
  actorId: string,
  input: {
    limit: number;
    cursor?: string;
    type?: "comment" | "mention" | "follow" | "request" | "accepted";
  },
) {
  return (input.cursor ? decodeCursor(input.cursor) : ok(undefined)).asyncAndThen((cursor) =>
    repository
      .listActivity(db, actorId, input.limit + 1, cursor, input.type)
      .andThen((rows) =>
        repository
          .unreadCount(db, actorId)
          .map((unreadCount) => ({ ...toPage(rows, input.limit), unreadCount })),
      ),
  );
}
export { markRead } from "./repository";
