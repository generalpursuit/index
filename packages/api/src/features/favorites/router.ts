import { implement } from "@orpc/server";
import type { Context } from "../../context";
import { requireAuth, unwrapResult } from "../../procedures";
import { favoritesContract } from "./contract";
import * as service from "./service";

const api = implement(favoritesContract).$context<Context>().use(requireAuth);
export const favoritesRouter = api.router({
  add: api.add.handler(async ({ context, input }) =>
    unwrapResult(await service.favoriteLink(context.db, context.actorId, input.linkId)),
  ),
  remove: api.remove.handler(async ({ context, input }) =>
    unwrapResult(await service.unfavoriteLink(context.db, context.actorId, input.linkId)),
  ),
  group: api.group.handler(async ({ context }) =>
    unwrapResult(await service.getFavoritesGroup(context.db, context.actorId)),
  ),
  list: api.list.handler(async ({ context, input }) =>
    unwrapResult(await service.listFavorites(context.db, context.actorId, input)),
  ),
});
