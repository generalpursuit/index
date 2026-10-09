import type { QueryDatabase } from "../../data-access/database";
import { withFollowedBy } from "../profiles/repository";
import * as repository from "./repository";

export function searchUsers(
  db: QueryDatabase,
  viewerId: string | null,
  input: { query: string; limit: number; after?: string },
) {
  return repository
    .searchUsers(db, viewerId, input.query, input.limit + 1, input.after)
    .andThen((rows) => {
      const items = rows.slice(0, input.limit);
      return withFollowedBy(db, viewerId, items).map((people) => ({
        items: people,
        nextAfter: rows.length > input.limit ? items.at(-1)!.id : null,
      }));
    });
}

/** People followed by the people you follow, most shared first. */
export const recommendations = (db: QueryDatabase, actorId: string, limit: number) =>
  repository
    .recommendations(db, actorId, limit)
    .andThen((rows) => withFollowedBy(db, actorId, rows))
    .map((items) => ({ items }));
