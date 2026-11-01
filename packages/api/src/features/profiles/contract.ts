import { openapi } from "@orpc/openapi";
import { agentTool } from "../../agent-tools";
import { usernameSchema } from "@index/auth/username";
import { optionalAuth } from "../../shared/schemas";
import { z } from "zod";
import { baseContract, userIdSchema } from "../../shared/schemas";
import { profileSchema, updateProfileSchema, uploadImageSchema } from "./schemas";

export const profilesContract = {
  me: baseContract
    .meta(
      openapi({
        method: "GET",
        path: "/me/profile",
        tags: ["Profiles"],
        summary: "Get your profile",
        description:
          "Returns the signed-in user's own profile: user ID, name, username, photo, whether the profile is public or private, and follower, following and link counts. Use it to learn who the user is before acting for them.",
      }),
      agentTool({ name: "get_me", permission: "read" }),
    )
    .input(z.strictObject({}).optional())
    .output(profileSchema),
  get: baseContract
    .meta(
      openapi({
        spec: optionalAuth,
        method: "GET",
        path: "/profiles/{userId}",
        tags: ["Profiles"],
        summary: "Get a person's profile",
        description:
          "Returns a person's profile by user ID: name, username, photo, whether the profile is private, whether the signed-in user follows them (`followingStatus`) and may see their links (`canViewContent`), and who they follow that follows the person too. Counts are null where the person's privacy hides them. To find someone by name or username, search people first.",
      }),
      agentTool({ name: "get_person", permission: "read" }),
    )
    .input(
      z.strictObject({
        userId: userIdSchema.describe(
          "The person's user ID, as people search, a link's `ownerId` or a resolved Index address gives it.",
        ),
      }),
    )
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
