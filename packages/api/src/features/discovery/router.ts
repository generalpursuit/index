import { requireVerifiedSession } from "../../procedures";
import { implement } from "@orpc/server";
import type { Context } from "../../context";
import { requireAuth, unwrapResult } from "../../procedures";
import { discoveryContract } from "./contract";
import * as service from "./service";

const implementer = implement(discoveryContract).$context<Context>();
const api = implementer.use(requireVerifiedSession);
// Procedures carry `api`'s middleware; building the router from `api` would run it again.
export const discoveryRouter = implementer.router({
  searchUsers: api.searchUsers.handler(async ({ context, input }) =>
    unwrapResult(await service.searchUsers(context.db, context.session?.user.id ?? null, input)),
  ),
  recommendations: api.recommendations
    .use(requireAuth)
    .handler(async ({ context, input }) =>
      unwrapResult(await service.recommendations(context.db, context.actorId, input.limit)),
    ),
});
