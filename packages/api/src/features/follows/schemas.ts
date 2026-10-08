import { z } from "zod";
import { userIdSchema, userPageInputSchema } from "../../shared/schemas";
import { publicUserSchema } from "../profiles/schemas";

export const followTargetSchema = z.strictObject({ userId: userIdSchema });
export const followStateSchema = z.object({ status: z.enum(["pending", "accepted"]) });
export const listFollowsSchema = userPageInputSchema.extend({ userId: userIdSchema });
export const userPageSchema = z.object({
  items: z.array(publicUserSchema),
  nextAfter: userIdSchema.nullable(),
});
