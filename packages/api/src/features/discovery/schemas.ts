import { z } from "zod";
import { userIdSchema, userPageInputSchema } from "../../shared/schemas";
import { followedBySchema, publicUserSchema } from "../profiles/schemas";

export const searchUsersSchema = userPageInputSchema.extend({
  query: z.string().trim().min(1).max(100),
});
export const recommendationsInputSchema = z.strictObject({
  limit: z.number().int().min(1).max(50).default(20),
});
/** A person as Discover shows them, with who you follow that follows them too. */
export const discoveredUserSchema = publicUserSchema.extend({
  followedBy: followedBySchema,
  followingStatus: z.enum(["pending", "accepted"]).nullable(),
});
export const discoveredUserPageSchema = z.object({
  items: z.array(discoveredUserSchema),
  nextAfter: userIdSchema.nullable(),
});
export const recommendationsSchema = z.object({ items: z.array(discoveredUserSchema) });
