import { requireVerifiedSession } from "../../procedures";
import { implement } from "@orpc/server";
import type { Context } from "../../context";
import { requireAuth, unwrapResult } from "../../procedures";
import { followsContract } from "./contract";
import * as service from "./service";

const api = implement(followsContract).$context<Context>().use(requireVerifiedSession);
export const followsRouter = api.router({
  follow: api.follow
    .use(requireAuth)
    .handler(async ({ context, input }) =>
      unwrapResult(await service.followUser(context.db, context.actorId, input.userId)),
    ),
  unfollow: api.unfollow
    .use(requireAuth)
    .handler(async ({ context, input }) =>
      unwrapResult(await service.removeFollow(context.db, context.actorId, input.userId)),
    ),
  followers: api.followers.handler(async ({ context, input }) =>
    unwrapResult(
      await service.listNetwork(
        context.db,
        context.session?.user.id ?? null,
        input.userId,
        "followers",
        input.limit,
        input.after,
        input.query,
      ),
    ),
  ),
  following: api.following.handler(async ({ context, input }) =>
    unwrapResult(
      await service.listNetwork(
        context.db,
        context.session?.user.id ?? null,
        input.userId,
        "following",
        input.limit,
        input.after,
        input.query,
      ),
    ),
  ),
  requests: api.requests
    .use(requireAuth)
    .handler(async ({ context, input }) =>
      unwrapResult(
        await service.listNetwork(
          context.db,
          context.actorId,
          context.actorId,
          "requests",
          input.limit,
          input.after,
        ),
      ),
    ),
  accept: api.accept
    .use(requireAuth)
    .handler(async ({ context, input }) =>
      unwrapResult(await service.acceptFollow(context.db, context.actorId, input.userId)),
    ),
  reject: api.reject
    .use(requireAuth)
    .handler(async ({ context, input }) =>
      unwrapResult(await service.removeFollow(context.db, input.userId, context.actorId, true)),
    ),
  removeFollower: api.removeFollower
    .use(requireAuth)
    .handler(async ({ context, input }) =>
      unwrapResult(await service.removeFollow(context.db, input.userId, context.actorId)),
    ),
});
