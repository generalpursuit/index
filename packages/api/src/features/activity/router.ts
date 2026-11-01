import { implement } from "@orpc/server";
import type { Context } from "../../context";
import { requireAuth, unwrapResult } from "../../procedures";
import { activityContract } from "./contract";
import * as service from "./service";
const implementer = implement(activityContract).$context<Context>();
const api = implementer.use(requireAuth);
// Procedures carry `api`'s middleware; building the router from `api` would run it again.
export const activityRouter = implementer.router({
  list: api.list.handler(async ({ context, input }) =>
    unwrapResult(await service.listActivity(context.db, context.actorId, input)),
  ),
  markRead: api.markRead.handler(async ({ context, input }) =>
    unwrapResult(await service.markRead(context.db, context.actorId, input.ids)),
  ),
});
