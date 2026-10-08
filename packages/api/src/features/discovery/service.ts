import type { QueryDatabase } from "../../data-access/database";
import * as repository from "./repository";

export function searchUsers(
  db: QueryDatabase,
  input: { query: string; limit: number; after?: string },
) {
  return repository.searchUsers(db, input.query, input.limit + 1, input.after).map((rows) => {
    const items = rows.slice(0, input.limit);
    return { items, nextAfter: rows.length > input.limit ? items.at(-1)!.id : null };
  });
}
export const recommendations = (db: QueryDatabase, actorId: string, limit: number) =>
  repository.recommendations(db, actorId, limit).map((items) => ({ items }));
