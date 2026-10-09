import { implement, ORPCError } from "@orpc/server";
import type { Context } from "../../context";
import { requireAuth, unwrapResult } from "../../procedures";
import { groupsContract } from "./contract";
import * as service from "./service";

const api = implement(groupsContract).$context<Context>();
export const groupsRouter = api.router({
  create: api.create
    .use(requireAuth)
    .handler(async ({ context, input }) =>
      unwrapResult(await service.createGroup(context.db, context.actorId, input)),
    ),
  get: api.get.handler(async ({ context, input }) =>
    unwrapResult(await service.getGroup(context.db, context.session?.user.id ?? null, input.id)),
  ),
  list: api.list.handler(async ({ context, input }) => {
    const viewerId = context.session?.user.id ?? null;
    const ownerId = input.ownerId ?? viewerId;
    if (!ownerId) throw new ORPCError("UNAUTHORIZED");
    return unwrapResult(
      await service.listGroups(context.db, viewerId, ownerId, input.limit, input.cursor),
    );
  }),
  update: api.update
    .use(requireAuth)
    .handler(async ({ context, input }) =>
      unwrapResult(await service.updateGroup(context.db, context.actorId, input)),
    ),
  delete: api.delete
    .use(requireAuth)
    .handler(async ({ context, input }) =>
      unwrapResult(
        await service.deleteGroup(context.db, context.actorId, input.id, input.deleteLinks),
      ),
    ),
});
