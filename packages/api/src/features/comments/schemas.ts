import { z } from "zod";
import { pageInputSchema, userIdSchema } from "../../shared/schemas";
import { publicUserSchema } from "../profiles/schemas";

const bodySchema = z.string().trim().min(1).max(5000);
export const commentSchema = z.object({
  id: z.uuid(),
  linkId: z.uuid(),
  authorId: userIdSchema,
  body: bodySchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const createCommentSchema = z.strictObject({ linkId: z.uuid(), body: bodySchema });
export const updateCommentSchema = z.strictObject({ id: z.uuid(), body: bodySchema });
export const listCommentsSchema = pageInputSchema.extend({ linkId: z.uuid() });
export const commentPageSchema = z.object({
  items: z.array(commentSchema.extend({ author: publicUserSchema })),
  nextCursor: z.string().nullable(),
});
