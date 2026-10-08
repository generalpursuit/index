import { implement } from "@orpc/server";
import type { Context } from "../../context";
import { requireAuth, unwrapResult } from "../../procedures";
import { starsContract } from "./contract";
import * as service from "./service";

const api = implement(starsContract).$context<Context>().use(requireAuth);
export const starsRouter = api.router({
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
