import { oc, type ContractRouterClient } from "@orpc/contract";
import { z } from "zod";

import { linksContract } from "./features/links/contract";
import { groupsContract } from "./features/groups/contract";
import { profilesContract } from "./features/profiles/contract";
import { followsContract } from "./features/follows/contract";
import { starsContract } from "./features/stars/contract";

export const appContract = {
  healthCheck: oc
    .route({ method: "GET", path: "/health", tags: ["System"], spec: { security: [] } })
    .input(z.strictObject({}).optional())
    .output(z.literal("OK")),
  privateData: oc
    .route({ method: "GET", path: "/private-data", tags: ["System"] })
    .errors({ UNAUTHORIZED: { message: "Sign in to continue." } })
    .input(z.strictObject({}).optional())
    .output(
      z.object({
        message: z.string(),
        user: z.object({
          id: z.string(),
          name: z.string(),
          email: z.email(),
          emailVerified: z.boolean(),
          image: z.string().nullable(),
          createdAt: z.iso.datetime(),
          updatedAt: z.iso.datetime(),
        }),
      }),
    ),
  links: linksContract,
  groups: groupsContract,
  profiles: profilesContract,
  follows: followsContract,
  stars: starsContract,
};

export type AppRouterClient = ContractRouterClient<typeof appContract>;
