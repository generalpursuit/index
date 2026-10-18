import { z } from "zod";
import { pageInputSchema, userIdSchema } from "../../shared/schemas";
import { publicUserSchema } from "../profiles/schemas";
import { linkSchema } from "../links/schemas";
import { maxFileBytes, maxFilesPerMessage } from "./files";
export const conversationTargetSchema = z.strictObject({ conversationId: z.uuid() });
export const createConversationSchema = z.strictObject({
  recipientIds: z
    .array(userIdSchema)
    .min(1)
    .max(19)
    .refine((ids) => new Set(ids).size === ids.length, "Choose each recipient once."),
});
export const messageFileSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.string(),
  size: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});
// The REST handler's coercion turns multipart text into numbers before validation.
const dimension = z.number().int().min(1).max(100_000).optional();
export const uploadFileSchema = z.strictObject({
  conversationId: z.uuid(),
  file: z.file().max(maxFileBytes),
  // An image's pixel size, measured by the client so threads can reserve its space.
  width: dimension,
  height: dimension,
});
export const fileTargetSchema = z.strictObject({ conversationId: z.uuid(), fileId: z.uuid() });
/** The start of a replied message; its attachment stays behind its own visibility rules. */
export const messageReplySchema = z.object({
  id: z.uuid(),
  senderId: userIdSchema,
  excerpt: z.string(),
  hasAttachment: z.boolean(),
  files: z.array(messageFileSchema),
});
export const messageSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  senderId: userIdSchema,
  clientId: z.uuid(),
  body: z.string(),
  createdAt: z.iso.datetime(),
  attachment: linkSchema.nullable(),
  hasAttachment: z.boolean(),
  restrictedAuthor: publicUserSchema.nullable(),
  replyTo: messageReplySchema.nullable(),
  files: z.array(messageFileSchema),
});
export const conversationSchema = z.object({
  id: z.uuid(),
  shortId: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
  participants: z.array(publicUserSchema),
  canSend: z.boolean(),
  unreadCount: z.number().int().nonnegative(),
  /** The viewer's newest message that every other member has read. */
  readReceiptMessageId: z.uuid().nullable(),
  lastMessage: messageSchema.nullable(),
  updatedAt: z.iso.datetime(),
});
export const conversationPageSchema = z.object({
  items: z.array(conversationSchema),
  nextCursor: z.string().nullable(),
});
export const messagesInputSchema = pageInputSchema.extend({ conversationId: z.uuid() });
export const messagePageSchema = z.object({
  items: z.array(messageSchema),
  nextCursor: z.string().nullable(),
});
/** The longest message text the API accepts. */
export const maxBodyLength = 10_000;
export const sendMessageSchema = z
  .strictObject({
    conversationId: z.uuid(),
    clientId: z.uuid(),
    body: z.string().trim().max(maxBodyLength).default(""),
    linkId: z.uuid().optional(),
    replyToMessageId: z.uuid().optional(),
    fileIds: z
      .array(z.uuid())
      .max(maxFilesPerMessage)
      .refine(
        (ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
        "Attach each file once.",
      )
      .default([]),
  })
  .refine(
    (input) => !!input.body || !!input.linkId || input.fileIds.length > 0,
    "Provide text, a link or files.",
  );
export const readMessageSchema = z.strictObject({ conversationId: z.uuid(), messageId: z.uuid() });
export type SendMessageInput = z.output<typeof sendMessageSchema>;

export const conversationListSchema = pageInputSchema.extend({
  query: z.string().trim().max(100).optional(),
});
