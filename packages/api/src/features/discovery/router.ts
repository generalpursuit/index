import { implement } from "@orpc/server";
import type { Context } from "../../context";
import { requireAuth, unwrapResult } from "../../procedures";
import { discoveryContract } from "./contract";
import * as service from "./service";

const api = implement(discoveryContract).$context<Context>();
export const discoveryRouter = api.router({
  searchUsers: api.searchUsers.handler(async ({ context, input }) =>
    unwrapResult(await service.searchUsers(context.db, input)),
  ),
  recommendations: api.recommendations
    .use(requireAuth)
    .handler(async ({ context, input }) =>
      unwrapResult(await service.recommendations(context.db, context.actorId, input.limit)),
    ),
});
