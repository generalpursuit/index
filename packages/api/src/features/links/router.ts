import { implement } from "@orpc/server";

import type { Context } from "../../context";
import { requireAuth, unwrapResult } from "../../procedures";
import { linksContract } from "./contract";
import { createLink, getLink, listMyLinks } from "./service";

const authenticated = implement(linksContract).$context<Context>().use(requireAuth);

export const linksRouter = authenticated.router({
  create: authenticated.create.handler(async ({ context, input }) =>
    unwrapResult(await createLink(context.db, context.actorId, input)),
  ),
  get: authenticated.get.handler(async ({ context, input }) =>
    unwrapResult(await getLink(context.db, context.actorId, input.id)),
  ),
  listMine: authenticated.listMine.handler(async ({ context, input }) =>
    unwrapResult(await listMyLinks(context.db, context.actorId, input)),
  ),
});
