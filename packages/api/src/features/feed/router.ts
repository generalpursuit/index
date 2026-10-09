import { implement } from "@orpc/server";
import type { Context } from "../../context";
import { requireAuth, unwrapResult } from "../../procedures";
import { feedContract } from "./contract";
import { feedWeeks, listFeed, weekFeed } from "./service";

const api = implement(feedContract).$context<Context>().use(requireAuth);
export const feedRouter = api.router({
  week: api.week.handler(async ({ context, input }) =>
    unwrapResult(await weekFeed(context.db, context.actorId, input)),
  ),
  weeks: api.weeks.handler(async ({ context, input }) =>
    unwrapResult(await feedWeeks(context.db, context.actorId, input)),
  ),
  list: api.list.handler(async ({ context, input }) =>
    unwrapResult(await listFeed(context.db, context.actorId, input)),
  ),
});
