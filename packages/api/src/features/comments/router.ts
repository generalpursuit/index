import { requireVerifiedSession } from "../../procedures";
import { implement } from "@orpc/server";
import type { Context } from "../../context";
import { requireAuth, unwrapResult } from "../../procedures";
import { commentsContract } from "./contract";
import * as service from "./service";

const implementer = implement(commentsContract).$context<Context>();
const api = implementer.use(requireVerifiedSession);
// Procedures carry `api`'s middleware; building the router from `api` would run it again.
export const commentsRouter = implementer.router({
  create: api.create
    .use(requireAuth)
    .handler(async ({ context, input }) =>
      unwrapResult(
        await service.createComment(context.db, context.actorId, input.linkId, input.body),
      ),
    ),
  list: api.list.handler(async ({ context, input }) =>
    unwrapResult(await service.listComments(context.db, context.session?.user.id ?? null, input)),
  ),
  update: api.update
    .use(requireAuth)
    .handler(async ({ context, input }) =>
      unwrapResult(await service.updateComment(context.db, context.actorId, input.id, input.body)),
    ),
  delete: api.delete
    .use(requireAuth)
    .handler(async ({ context, input }) =>
      unwrapResult(await service.deleteComment(context.db, context.actorId, input.id)),
    ),
});
