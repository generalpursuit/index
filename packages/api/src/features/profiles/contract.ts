import { usernameSchema } from "@index/auth/username";
import { optionalAuth } from "../../shared/schemas";
import { z } from "zod";
import { baseContract, userIdSchema } from "../../shared/schemas";
import { profileSchema, updateProfileSchema, uploadImageSchema } from "./schemas";

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
  uploadImage: baseContract
    .route({
      method: "POST",
      path: "/me/image",
      summary: "Upload a profile photo (JPEG, PNG or WebP, at most 5 MB); replaces the current one",
      tags: ["Profiles"],
    })
    .input(uploadImageSchema)
    .output(profileSchema),
};
