import { implement } from "@orpc/server";
import type { Context } from "../../context";
import { requireVerifiedSession, unwrapResult } from "../../procedures";
import { routesContract } from "./contract";
import { resolveRoute } from "./resolve";

const api = implement(routesContract).$context<Context>();
export const routesRouter = api.router({
  resolve: api.resolve
    .use(requireVerifiedSession)
    .handler(async ({ context, input }) =>
      unwrapResult(await resolveRoute(context.db, context.session?.user.id ?? null, input)),
    ),
});
