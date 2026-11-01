import { openapi } from "@orpc/openapi";
import { usernameSchema } from "@index/auth/username";
import { optionalAuth } from "../../shared/schemas";
import { z } from "zod";
import { baseContract, userIdSchema } from "../../shared/schemas";
import { profileSchema, updateProfileSchema, uploadImageSchema } from "./schemas";

export const profilesContract = {
  me: baseContract
    .meta(openapi({ method: "GET", path: "/me/profile", tags: ["Profiles"] }))
    .input(z.strictObject({}).optional())
    .output(profileSchema),
  get: baseContract
    .meta(
      openapi({
        spec: optionalAuth,
        method: "GET",
        path: "/profiles/{userId}",
        tags: ["Profiles"],
      }),
    )
    .input(z.strictObject({ userId: userIdSchema }))
    .output(profileSchema),
  byUsername: baseContract
    .meta(
      openapi({
        spec: optionalAuth,
        method: "GET",
        path: "/profiles/by-username/{username}",
        tags: ["Profiles"],
      }),
    )
    .input(z.strictObject({ username: usernameSchema }))
    .output(profileSchema),
  update: baseContract
    .meta(openapi({ method: "PATCH", path: "/me/profile", tags: ["Profiles"] }))
    .input(updateProfileSchema)
    .output(profileSchema),
  uploadImage: baseContract
    .meta(
      openapi({
        method: "POST",
        path: "/me/image",
        summary:
          "Upload a profile photo (JPEG, PNG or WebP, at most 5 MB); replaces the current one",
        tags: ["Profiles"],
      }),
    )
    .input(uploadImageSchema)
    .output(profileSchema),
};
