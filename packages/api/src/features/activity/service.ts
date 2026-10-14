import { ok, ResultAsync } from "neverthrow";
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
    ResultAsync.combine([
      repository.listActivity(db, actorId, input.limit + 1, cursor, input.type),
      repository.unreadCount(db, actorId),
    ]).map(([rows, unreadCount]) => ({ ...toPage(rows, input.limit), unreadCount })),
  );
}
export { markRead } from "./repository";
