import { z } from "zod";
import { httpUrlSchema, userIdSchema, visibilitySchema } from "../../shared/schemas";

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9_]+$/);
export const publicUserSchema = z.object({
  id: userIdSchema,
  name: z.string(),
  username: z.string().nullable(),
  bio: z.string().nullable(),
  image: z.string().nullable(),
  profileVisibility: visibilitySchema,
});
export const profileSchema = publicUserSchema.extend({
  canViewContent: z.boolean(),
  followingStatus: z.enum(["pending", "accepted"]).nullable(),
});
export const updateProfileSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(80).optional(),
    username: usernameSchema.optional(),
    bio: z.string().trim().max(500).nullable().optional(),
    image: httpUrlSchema.nullable().optional(),
    profileVisibility: visibilitySchema.optional(),
  })
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    "Provide a change.",
  );
export type UpdateProfileInput = z.output<typeof updateProfileSchema>;
