import { openapi } from "@orpc/openapi";
import { optionalAuth } from "../../shared/schemas";
import { baseContract, successSchema, userPageInputSchema } from "../../shared/schemas";
import {
  followStateSchema,
  followTargetSchema,
  listFollowsSchema,
  userPageSchema,
} from "./schemas";

export const followsContract = {
  follow: baseContract
    .meta(openapi({ method: "POST", path: "/profiles/{userId}/follow", tags: ["Follows"] }))
    .input(followTargetSchema)
    .output(followStateSchema),
  unfollow: baseContract
    .meta(openapi({ method: "DELETE", path: "/profiles/{userId}/follow", tags: ["Follows"] }))
    .input(followTargetSchema)
    .output(successSchema),
  followers: baseContract
    .meta(
      openapi({
        spec: optionalAuth,
        method: "GET",
        path: "/profiles/{userId}/followers",
        tags: ["Follows"],
      }),
    )
    .input(listFollowsSchema)
    .output(userPageSchema),
  following: baseContract
    .meta(
      openapi({
        spec: optionalAuth,
        method: "GET",
        path: "/profiles/{userId}/following",
        tags: ["Follows"],
      }),
    )
    .input(listFollowsSchema)
    .output(userPageSchema),
  requests: baseContract
    .meta(openapi({ method: "GET", path: "/me/follow-requests", tags: ["Follows"] }))
    .input(userPageInputSchema)
    .output(userPageSchema),
  accept: baseContract
    .meta(
      openapi({ method: "POST", path: "/me/follow-requests/{userId}/accept", tags: ["Follows"] }),
    )
    .input(followTargetSchema)
    .output(followStateSchema),
  reject: baseContract
    .meta(openapi({ method: "DELETE", path: "/me/follow-requests/{userId}", tags: ["Follows"] }))
    .input(followTargetSchema)
    .output(successSchema),
  removeFollower: baseContract
    .meta(openapi({ method: "DELETE", path: "/me/followers/{userId}", tags: ["Follows"] }))
    .input(followTargetSchema)
    .output(successSchema),
};
