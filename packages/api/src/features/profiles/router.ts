import { implement } from "@orpc/server";
import type { Context } from "../../context";
import { requireAuth, unwrapResult } from "../../procedures";
import { profilesContract } from "./contract";
import * as service from "./service";

const api = implement(profilesContract).$context<Context>();
export const profilesRouter = api.router({
  me: api.me
    .use(requireAuth)
    .handler(async ({ context }) =>
      unwrapResult(
        await service.getProfile(context.db, context.actorId, { userId: context.actorId }),
      ),
    ),
  get: api.get.handler(async ({ context, input }) =>
    unwrapResult(await service.getProfile(context.db, context.session?.user.id ?? null, input)),
  ),
  byUsername: api.byUsername.handler(async ({ context, input }) =>
    unwrapResult(await service.getProfile(context.db, context.session?.user.id ?? null, input)),
  ),
  update: api.update
    .use(requireAuth)
    .handler(async ({ context, input }) =>
      unwrapResult(await service.updateProfile(context.db, context.actorId, input)),
    ),
});
