import { err, ok, ResultAsync } from "neverthrow";

import type { QueryDatabase } from "../../data-access/database";
import type { ApplicationError } from "../../errors";
import type { FetchPage } from "../links/metadata";
import { readCurateeProfile } from "./curatee";
import { saveCurateeLinks } from "./repository";

/** Imports a curatee profile's links; importing it again adds only links that are new there. */
export function importCuratee(
  db: QueryDatabase,
  actorId: string,
  username: string,
  fetchImport: FetchPage,
) {
  return ResultAsync.fromPromise(
    readCurateeProfile(username, fetchImport),
    (cause): ApplicationError => ({
      code: "BAD_GATEWAY",
      message: "curatee.co can't be reached right now. Try again later.",
      cause,
    }),
  )
    .andThen((links) =>
      links
        ? ok(links)
        : err<never, ApplicationError>({
            code: "NOT_FOUND",
            message: "No curatee profile has that username.",
          }),
    )
    .andThen((links) => saveCurateeLinks(db, actorId, links))
    .map((imported) => ({ imported }));
}
