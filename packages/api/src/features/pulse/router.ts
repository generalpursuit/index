import { implement } from "@orpc/server";
import type { Context } from "../../context";
import { requireAuth, unwrapResult } from "../../procedures";
import { pulseContract } from "./contract";
import { getPulse } from "./service";

const api = implement(pulseContract).$context<Context>().use(requireAuth);
export const pulseRouter = api.router({
  get: api.get.handler(async ({ context }) =>
    unwrapResult(await getPulse(context.db, context.actorId)),
  ),
});
