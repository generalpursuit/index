import { implement, ORPCError } from "@orpc/server";
import type { Context } from "../../context";
import { requireAuth } from "../../procedures";
import { liveContract } from "./contract";

const api = implement(liveContract).$context<Context>().use(requireAuth);
export const liveRouter = api.router({
  ticket: api.ticket.handler(({ context }) => {
    if (!context.live)
      throw new ORPCError("NOT_IMPLEMENTED", { message: "Live updates are unavailable." });
    return context.live.ticket(context.session);
  }),
});
