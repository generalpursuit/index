import { implement } from "@orpc/server";

import type { Context } from "../../context";
import { requireAuth, requireVerifiedSession, unwrapResult } from "../../procedures";
import { importsContract } from "./contract";
import { importCuratee } from "./service";

const api = implement(importsContract).$context<Context>().use(requireVerifiedSession);

export const importsRouter = api.router({
  curatee: api.curatee
    .use(requireAuth)
    .handler(async ({ context, input }) =>
      unwrapResult(
        await importCuratee(context.db, context.actorId, input.username, context.fetchImport),
      ),
    ),
});
