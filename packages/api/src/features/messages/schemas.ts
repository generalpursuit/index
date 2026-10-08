import { z } from "zod";
import { pageInputSchema, userIdSchema } from "../../shared/schemas";
import { publicUserSchema } from "../profiles/schemas";
import { linkSchema } from "../links/schemas";
export const conversationTargetSchema = z.strictObject({ conversationId: z.uuid() });
export const createConversationSchema = z.strictObject({
  recipientIds: z
    .array(userIdSchema)
    .min(1)
    .max(19)
    .refine((ids) => new Set(ids).size === ids.length, "Choose each recipient once."),
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
});
export const conversationSchema = z.object({
  id: z.uuid(),
  participants: z.array(publicUserSchema),
  canSend: z.boolean(),
  unreadCount: z.number().int().nonnegative(),
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
export const sendMessageSchema = z
  .strictObject({
    conversationId: z.uuid(),
    clientId: z.uuid(),
    body: z.string().trim().max(10000).default(""),
    linkId: z.uuid().optional(),
  })
  .refine((input) => !!input.body || !!input.linkId, "Provide text or a link.");
export const readMessageSchema = z.strictObject({ conversationId: z.uuid(), messageId: z.uuid() });
export type SendMessageInput = z.output<typeof sendMessageSchema>;

export const conversationListSchema = pageInputSchema.extend({
  query: z.string().trim().max(100).optional(),
});
