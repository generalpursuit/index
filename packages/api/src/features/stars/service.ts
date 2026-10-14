import { err, ok } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { notFound } from "../../errors";
import { ensureSystemGroup } from "../groups/repository";
import { listInGroup } from "../links/service";
import * as repository from "./repository";

export const getStarredGroup = (db: QueryDatabase, actorId: string) =>
  repository
    .findStarredGroup(db, actorId)
    .andThen((group) =>
      group
        ? ok(group)
        : ensureSystemGroup(db, actorId, "starred").andThen(() =>
            repository.findStarredGroup(db, actorId),
          ),
    )
    .andThen((group) => (group ? ok(group) : err(notFound("Starred group"))));

export const starLink = (db: QueryDatabase, actorId: string, linkId: string) =>
  getStarredGroup(db, actorId)
    .andThen(() => repository.starLink(db, actorId, linkId))
    .andThen((link) => (link ? ok({ success: true as const }) : err(notFound("Link"))));

export const listStars = (
  db: QueryDatabase,
  actorId: string,
  input: { limit: number; cursor?: string },
) =>
  getStarredGroup(db, actorId).andThen((group) =>
    listInGroup(db, actorId, { ...input, groupId: group.id }),
  );
export { unstarLink } from "./repository";
