import { implement } from "@orpc/server";
import type { Context } from "../../context";
import { requireAuth, unwrapResult } from "../../procedures";
import { favoritesContract } from "./contract";
import * as service from "./service";

const implementer = implement(favoritesContract).$context<Context>();
const api = implementer.use(requireAuth);
// Procedures carry `api`'s middleware; building the router from `api` would run it again.
export const favoritesRouter = implementer.router({
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
