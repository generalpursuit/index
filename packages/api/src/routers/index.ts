import { requireVerifiedSession } from "../procedures";
import { activityRouter } from "../features/activity/router";
import { messagesRouter } from "../features/messages/router";
import { favoritesRouter } from "../features/favorites/router";
import { implement } from "@orpc/server";

import type { Context } from "../context";
import { appContract } from "../contracts";
import { linksRouter } from "../features/links/router";
import { groupsRouter } from "../features/groups/router";
import { profilesRouter } from "../features/profiles/router";
import { followsRouter } from "../features/follows/router";
import { starsRouter } from "../features/stars/router";
import { commentsRouter } from "../features/comments/router";
import { feedRouter } from "../features/feed/router";
import { discoveryRouter } from "../features/discovery/router";
import { requireAuth } from "../procedures";

const api = implement(appContract).$context<Context>().use(requireVerifiedSession);

export const appRouter = api.router({
  healthCheck: api.healthCheck.handler(() => {
    return "OK";
  }),
  privateData: api.privateData.use(requireAuth).handler(({ context }) => {
    const { user } = context.session;
    return {
      message: "This is private",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image ?? null,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
    };
  }),
  links: linksRouter,
  groups: groupsRouter,
  profiles: profilesRouter,
  follows: followsRouter,
  stars: starsRouter,
  activity: activityRouter,
  messages: messagesRouter,
  favorites: favoritesRouter,
  comments: commentsRouter,
  feed: feedRouter,
  discovery: discoveryRouter,
});
export type AppRouter = typeof appRouter;
export type { AppRouterClient } from "../contracts";
