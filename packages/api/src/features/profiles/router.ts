import { requireVerifiedSession } from "../../procedures";
import { implement } from "@orpc/server";
import type { Context } from "../../context";
import { requireAuth, unwrapResult } from "../../procedures";
import { profilesContract } from "./contract";
import * as service from "./service";

const api = implement(profilesContract).$context<Context>().use(requireVerifiedSession);
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
      unwrapResult(await service.updateProfile(context.db, context.media, context.actorId, input)),
    ),
  uploadImage: api.uploadImage.use(requireAuth).handler(async ({ context, input }) =>
    unwrapResult(
      // zod types files minimally; what arrives is a real File (a Blob).
      await service.uploadImage(
        context.db,
        context.media,
        context.actorId,
        input.image as unknown as Blob,
      ),
    ),
  ),
});
