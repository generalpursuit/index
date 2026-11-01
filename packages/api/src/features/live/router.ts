import { implement, ORPCError } from "@orpc/server";
import type { Context } from "../../context";
import { requireSession } from "../../procedures";
import { liveContract } from "./contract";

const implementer = implement(liveContract).$context<Context>();
const api = implementer.use(requireSession);
// Procedures carry `api`'s middleware; building the router from `api` would run it again.
export const liveRouter = implementer.router({
  ticket: api.ticket.handler(({ context }) => {
    if (!context.live)
      throw new ORPCError("NOT_IMPLEMENTED", { message: "Live updates are unavailable." });
    return context.live.ticket(context.session);
  }),
});
