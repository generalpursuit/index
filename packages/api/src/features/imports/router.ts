import { implement } from "@orpc/server";

import type { Context } from "../../context";
import { requireAuth, requireVerifiedSession, unwrapResult } from "../../procedures";
import { importsContract } from "./contract";
import { importCuratee } from "./service";

const implementer = implement(importsContract).$context<Context>();
const api = implementer.use(requireVerifiedSession);

// Procedures carry `api`'s middleware; building the router from `api` would run it again.
export const importsRouter = implementer.router({
  curatee: api.curatee
    .use(requireAuth)
    .handler(async ({ context, input }) =>
      unwrapResult(
        await importCuratee(context.db, context.actorId, input.username, context.fetchImport),
      ),
    ),
});
