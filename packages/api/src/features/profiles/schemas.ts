import { usernameSchema } from "@index/auth/username";
import { z } from "zod";
import { httpUrlSchema, userIdSchema, visibilitySchema } from "../../shared/schemas";

export const publicUserSchema = z.object({
  id: userIdSchema,
  name: z.string(),
  username: z.string().nullable(),
  image: z.string().nullable(),
  profileVisibility: visibilitySchema,
});
/** Up to two people the viewer follows who follow this person too, and how many in all. */
export const followedBySchema = z.object({
  users: z.array(publicUserSchema),
  total: z.number().int().nonnegative(),
});
export type FollowedBy = z.infer<typeof followedBySchema>;
export const profileSchema = publicUserSchema.extend({
  canViewContent: z.boolean(),
  followerCount: z.number().int().nonnegative().nullable(),
  followingCount: z.number().int().nonnegative().nullable(),
  linkCount: z.number().int().nonnegative().nullable(),
  followedBy: followedBySchema,
  followingStatus: z.enum(["pending", "accepted"]).nullable(),
});
export const updateProfileSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(80).optional(),
    username: usernameSchema.optional(),
    image: httpUrlSchema.nullable().optional(),
    profileVisibility: visibilitySchema.optional(),
  })
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    "Provide a change.",
  );
export type UpdateProfileInput = z.output<typeof updateProfileSchema>;
