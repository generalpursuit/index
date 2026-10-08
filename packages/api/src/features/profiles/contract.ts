import { usernameSchema } from "@index/auth/username";
import { optionalAuth } from "../../shared/schemas";
import { z } from "zod";
import { baseContract, userIdSchema } from "../../shared/schemas";
import { profileSchema, updateProfileSchema } from "./schemas";

export const profilesContract = {
  me: baseContract
    .route({ method: "GET", path: "/me/profile", tags: ["Profiles"] })
    .input(z.strictObject({}).optional())
    .output(profileSchema),
  get: baseContract
    .route({ spec: optionalAuth, method: "GET", path: "/profiles/{userId}", tags: ["Profiles"] })
    .input(z.strictObject({ userId: userIdSchema }))
    .output(profileSchema),
  byUsername: baseContract
    .route({
      spec: optionalAuth,
      method: "GET",
      path: "/profiles/by-username/{username}",
      tags: ["Profiles"],
    })
    .input(z.strictObject({ username: usernameSchema }))
    .output(profileSchema),
  update: baseContract
    .route({ method: "PATCH", path: "/me/profile", tags: ["Profiles"] })
    .input(updateProfileSchema)
    .output(profileSchema),
};
