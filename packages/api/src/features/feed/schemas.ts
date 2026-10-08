import { weekStartSchema, currentWeekStart } from "../../shared/weeks";
import { userIdSchema } from "../../shared/schemas";
import { listMyLinksOutputSchema } from "../links/schemas";
import { z } from "zod";
import { linkSchema } from "../links/schemas";
import { publicUserSchema } from "../profiles/schemas";

export const feedPageSchema = z.object({
  items: z.array(linkSchema.extend({ author: publicUserSchema })),
  nextCursor: z.string().nullable(),
});

export const weekFeedInputSchema = z.strictObject({
  weekStart: weekStartSchema.refine(
    (value) => value <= currentWeekStart(),
    "Choose this week or an earlier week.",
  ),
  after: userIdSchema.optional(),
  limit: z.number().int().min(1).max(30).default(10),
  linkLimit: z.number().int().min(1).max(100).default(20),
});
export const weekFeedSchema = z.object({
  weekStart: weekStartSchema,
  olderWeek: weekStartSchema.nullable(),
  newerWeek: weekStartSchema.nullable(),
  own: listMyLinksOutputSchema,
  people: z.array(z.object({ author: publicUserSchema, links: listMyLinksOutputSchema })),
  nextAfter: userIdSchema.nullable(),
});
