import { implement } from "@orpc/server";
import type { Context } from "../../context";
import { requireAuth, unwrapResult } from "../../procedures";
import { feedContract } from "./contract";
import { listFeed } from "./service";

const api = implement(feedContract).$context<Context>().use(requireAuth);
export const feedRouter = api.router({
  list: api.list.handler(async ({ context, input }) =>
    unwrapResult(await listFeed(context.db, context.actorId, input)),
  ),
});
