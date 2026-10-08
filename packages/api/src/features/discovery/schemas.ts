import { z } from "zod";
import { userPageInputSchema } from "../../shared/schemas";
import { publicUserSchema } from "../profiles/schemas";

export const searchUsersSchema = userPageInputSchema.extend({
  query: z.string().trim().min(1).max(100),
});
export const recommendationsInputSchema = z.strictObject({
  limit: z.number().int().min(1).max(50).default(20),
});
export const recommendationsSchema = z.object({
  items: z.array(publicUserSchema.extend({ mutualCount: z.number().int().positive() })),
});
