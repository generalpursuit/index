import { implement } from "@orpc/server";
import type { Context } from "../../context";
import { requireAuth, unwrapResult } from "../../procedures";
import { activityContract } from "./contract";
import * as service from "./service";
const api = implement(activityContract).$context<Context>().use(requireAuth);
export const activityRouter = api.router({
  list: api.list.handler(async ({ context, input }) =>
    unwrapResult(await service.listActivity(context.db, context.actorId, input)),
  ),
  markRead: api.markRead.handler(async ({ context, input }) =>
    unwrapResult(await service.markRead(context.db, context.actorId, input.ids)),
  ),
});
