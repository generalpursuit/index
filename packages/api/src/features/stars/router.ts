import { implement } from "@orpc/server";
import type { Context } from "../../context";
import { requireAuth, unwrapResult } from "../../procedures";
import { starsContract } from "./contract";
import * as service from "./service";

const implementer = implement(starsContract).$context<Context>();
const api = implementer.use(requireAuth);
// Procedures carry `api`'s middleware; building the router from `api` would run it again.
export const starsRouter = implementer.router({
  add: api.add.handler(async ({ context, input }) =>
    unwrapResult(await service.starLink(context.db, context.actorId, input.linkId)),
  ),
  remove: api.remove.handler(async ({ context, input }) =>
    unwrapResult(await service.unstarLink(context.db, context.actorId, input.linkId)),
  ),
  group: api.group.handler(async ({ context }) =>
    unwrapResult(await service.getStarredGroup(context.db, context.actorId)),
  ),
  list: api.list.handler(async ({ context, input }) =>
    unwrapResult(await service.listStars(context.db, context.actorId, input)),
  ),
});
