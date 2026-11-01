import { implement } from "@orpc/server";
import type { Context } from "../../context";
import { requireAuth, unwrapResult } from "../../procedures";
import { pulseContract } from "./contract";
import { getPulse } from "./service";

const implementer = implement(pulseContract).$context<Context>();
const api = implementer.use(requireAuth);
// Procedures carry `api`'s middleware; building the router from `api` would run it again.
export const pulseRouter = implementer.router({
  get: api.get.handler(async ({ context }) =>
    unwrapResult(await getPulse(context.db, context.actorId)),
  ),
});
