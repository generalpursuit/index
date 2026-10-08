import { currentWeekStart, shiftWeek } from "../../shared/weeks";
import { listByOwner } from "../links/service";
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

export function weekFeed(
  db: QueryDatabase,
  actorId: string,
  input: { weekStart: string; after?: string; limit: number; linkLimit: number },
) {
  return repository
    .weekAuthors(db, actorId, input.weekStart, input.limit + 1, input.after)
    .andThen((authors) => {
      const shown = authors.slice(0, input.limit);
      return ResultAsync.combine([
        listByOwner(db, actorId, {
          userId: actorId,
          weekStart: input.weekStart,
          limit: input.linkLimit,
        }),
        ...shown.map((author) =>
          listByOwner(db, actorId, {
            userId: author.id,
            weekStart: input.weekStart,
            limit: input.linkLimit,
          }),
        ),
      ]).map(([own, ...pages]) => ({
        weekStart: input.weekStart,
        olderWeek: input.weekStart === "0001-01-01" ? null : shiftWeek(input.weekStart, -1),
        newerWeek: input.weekStart < currentWeekStart() ? shiftWeek(input.weekStart, 1) : null,
        own: own!,
        people: shown.map((author, index) => ({ author, links: pages[index]! })),
        nextAfter: authors.length > input.limit ? shown.at(-1)!.id : null,
      }));
    });
}
