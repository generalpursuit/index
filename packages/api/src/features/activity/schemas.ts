import { z } from "zod";
import { pageInputSchema } from "../../shared/schemas";
import { publicUserSchema } from "../profiles/schemas";
export const activitySchema = z.object({
  id: z.uuid(),
  type: z.enum(["comment", "mention", "follow", "request", "accepted"]),
  actor: publicUserSchema,
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
  linkId: z.uuid().nullable(),
  commentId: z.uuid().nullable(),
  body: z.string().nullable(),
  requestStatus: z.enum(["pending", "accepted", "declined", "canceled"]).nullable(),
});
export const activityInputSchema = pageInputSchema.extend({
  type: z.enum(["comment", "mention", "follow", "request", "accepted"]).optional(),
});
export const activityPageSchema = z.object({
  items: z.array(activitySchema),
  nextCursor: z.string().nullable(),
  unreadCount: z.number().int().nonnegative(),
});
export const readActivitiesSchema = z.strictObject({ ids: z.array(z.uuid()).min(1).max(100) });
