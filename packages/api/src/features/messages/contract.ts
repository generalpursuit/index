import { z } from "zod";
import { baseContract, successSchema } from "../../shared/schemas";
import {
  conversationListSchema,
  createConversationSchema,
  conversationTargetSchema,
  conversationSchema,
  conversationPageSchema,
  messagesInputSchema,
  messagePageSchema,
  sendMessageSchema,
  messageSchema,
  readMessageSchema,
  uploadFileSchema,
  messageFileSchema,
  fileTargetSchema,
} from "./schemas";
export const messagesContract = {
  unread: baseContract
    .route({ method: "GET", path: "/me/messages/unread", tags: ["Messages"] })
    .input(z.strictObject({}).optional())
    .output(z.object({ unreadCount: z.number().int().nonnegative() })),
  createConversation: baseContract
    .route({ method: "POST", path: "/conversations", tags: ["Messages"] })
    .input(createConversationSchema)
    .output(conversationSchema),
  conversations: baseContract
    .route({ method: "GET", path: "/conversations", tags: ["Messages"] })
    .input(conversationListSchema)
    .output(conversationPageSchema),
  conversation: baseContract
    .route({ method: "GET", path: "/conversations/{conversationId}", tags: ["Messages"] })
    .input(conversationTargetSchema)
    .output(conversationSchema),
  list: baseContract
    .route({ method: "GET", path: "/conversations/{conversationId}/messages", tags: ["Messages"] })
    .input(messagesInputSchema)
    .output(messagePageSchema),
  send: baseContract
    .route({ method: "POST", path: "/conversations/{conversationId}/messages", tags: ["Messages"] })
    .input(sendMessageSchema)
    .output(messageSchema),
  markRead: baseContract
    .route({ method: "POST", path: "/conversations/{conversationId}/read", tags: ["Messages"] })
    .input(readMessageSchema)
    .output(successSchema),
  upload: baseContract
    .route({
      method: "POST",
      path: "/conversations/{conversationId}/files",
      summary: "Upload a file (at most 25 MB) to send in this conversation",
      tags: ["Messages"],
    })
    .input(uploadFileSchema)
    .output(messageFileSchema),
  file: baseContract
    .route({
      method: "GET",
      path: "/conversations/{conversationId}/files/{fileId}",
      summary: "Read a sent file",
      tags: ["Messages"],
    })
    .input(fileTargetSchema)
    .output(z.file()),
};
