import { requireVerifiedSession } from "../../procedures";
import { listByOwner, libraryWeeks } from "./service";
import { implement } from "@orpc/server";

import type { Context } from "../../context";
import { requireAuth, unwrapResult } from "../../procedures";
import { linksContract } from "./contract";
import { createLink, getLink, listMyLinks, updateLink, deleteLink, listInGroup } from "./service";

const api = implement(linksContract).$context<Context>().use(requireVerifiedSession);

export const linksRouter = api.router({
  weeks: api.weeks.handler(async ({ context, input }) =>
    unwrapResult(await libraryWeeks(context.db, context.session?.user.id ?? null, input)),
  ),
  listByOwner: api.listByOwner.handler(async ({ context, input }) =>
    unwrapResult(await listByOwner(context.db, context.session?.user.id ?? null, input)),
  ),
  create: api.create
    .use(requireAuth)
    .handler(async ({ context, input }) =>
      unwrapResult(await createLink(context.db, context.actorId, input, context.fetchPage)),
    ),
  get: api.get.handler(async ({ context, input }) =>
    unwrapResult(await getLink(context.db, context.session?.user.id ?? null, input.id)),
  ),
  listMine: api.listMine
    .use(requireAuth)
    .handler(async ({ context, input }) =>
      unwrapResult(await listMyLinks(context.db, context.actorId, input)),
    ),
  update: api.update
    .use(requireAuth)
    .handler(async ({ context, input }) =>
      unwrapResult(await updateLink(context.db, context.actorId, input, context.fetchPage)),
    ),
  delete: api.delete
    .use(requireAuth)
    .handler(async ({ context, input }) =>
      unwrapResult(await deleteLink(context.db, context.actorId, input.id)),
    ),
  listInGroup: api.listInGroup.handler(async ({ context, input }) =>
    unwrapResult(await listInGroup(context.db, context.session?.user.id ?? null, input)),
  ),
});
