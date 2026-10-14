import { currentWeekStart } from "../../shared/weeks";
import { ok, ResultAsync } from "neverthrow";
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

export const feedWeeks = (
  db: QueryDatabase,
  actorId: string,
  input: { before?: string; limit: number },
) => repository.homeWeeks(db, actorId, input);

export function weekFeed(
  db: QueryDatabase,
  actorId: string,
  input: { weekStart: string; after?: string; limit: number; linkLimit: number },
) {
  return ResultAsync.combine([
    repository.neighborWeeks(db, actorId, input.weekStart),
    repository
      .weekAuthors(db, actorId, input.weekStart, input.limit + 1, input.after)
      .andThen((authors) =>
        repository
          .weekLinks(
            db,
            actorId,
            [actorId, ...authors.slice(0, input.limit).map((author) => author.id)],
            input.weekStart,
            input.linkLimit,
          )
          .map((rows) => ({ authors, rows })),
      ),
  ]).map(([neighbors, { authors, rows }]) => ({
    weekStart: input.weekStart,
    // Navigation skips empty weeks, but the current week is always reachable for adding.
    olderWeek: neighbors.older,
    newerWeek:
      input.weekStart < currentWeekStart() ? (neighbors.newer ?? currentWeekStart()) : null,
    own: toPage(
      rows.filter((link) => link.ownerId === actorId),
      input.linkLimit,
    ),
    people: authors.slice(0, input.limit).map((author) => ({
      author,
      links: toPage(
        rows.filter((link) => link.ownerId === author.id),
        input.linkLimit,
      ),
    })),
    nextAfter: authors.length > input.limit ? authors[input.limit - 1]!.id : null,
  }));
}
