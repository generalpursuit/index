import { notificationsContract } from "./features/notifications/contract";
import { routesContract } from "./features/routes/contract";
import { activityContract } from "./features/activity/contract";
import { messagesContract } from "./features/messages/contract";
import { favoritesContract } from "./features/favorites/contract";
import { oc, type ContractRouterClient } from "@orpc/contract";
import { z } from "zod";

import { linksContract } from "./features/links/contract";
import { groupsContract } from "./features/groups/contract";
import { profilesContract } from "./features/profiles/contract";
import { followsContract } from "./features/follows/contract";
import { starsContract } from "./features/stars/contract";
import { commentsContract } from "./features/comments/contract";
import { feedContract } from "./features/feed/contract";
import { discoveryContract } from "./features/discovery/contract";
import { importsContract } from "./features/imports/contract";

export const appContract = {
  healthCheck: oc
    .route({ method: "GET", path: "/health", tags: ["System"], spec: { security: [] } })
    .input(z.strictObject({}).optional())
    .output(z.literal("OK")),
  notifications: notificationsContract,
  routes: routesContract,
  links: linksContract,
  groups: groupsContract,
  profiles: profilesContract,
  follows: followsContract,
  stars: starsContract,
  activity: activityContract,
  messages: messagesContract,
  favorites: favoritesContract,
  comments: commentsContract,
  feed: feedContract,
  discovery: discoveryContract,
  imports: importsContract,
};

export type AppRouterClient = ContractRouterClient<typeof appContract>;
