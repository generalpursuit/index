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
const commentedLinkSchema = z.uuid().describe("The ID of the link the comments are on.");
export const createCommentSchema = z.strictObject({
  linkId: commentedLinkSchema,
  body: bodySchema.describe(
    "The comment's plain text, up to 5000 characters. Write @username to mention someone.",
  ),
  clientId: z
    .uuid()
    .optional()
    .describe(
      "A new random UUID for each comment. Reuse it, with the same other fields, only to retry a comment whose outcome is unknown: the retry then returns the comment already posted instead of posting twice.",
    ),
});
export const updateCommentSchema = z.strictObject({ id: z.uuid(), body: bodySchema });
export const listCommentsSchema = pageInputSchema.extend({ linkId: commentedLinkSchema });
export const commentPageSchema = z.object({
  items: z.array(commentSchema.extend({ author: publicUserSchema })),
  nextCursor: z.string().nullable(),
});
