import { implement } from "@orpc/server";
import type { Context } from "../../context";
import { requireAuth, unwrapResult } from "../../procedures";
import { messagesContract } from "./contract";
import * as service from "./service";
const api = implement(messagesContract).$context<Context>().use(requireAuth);
export const messagesRouter = api.router({
  unread: api.unread.handler(async ({ context }) =>
    unwrapResult(await service.unreadCount(context.db, context.actorId)),
  ),
  createConversation: api.createConversation.handler(async ({ context, input }) =>
    unwrapResult(await service.createConversation(context.db, context.actorId, input.recipientIds)),
  ),
  conversations: api.conversations.handler(async ({ context, input }) =>
    unwrapResult(await service.listConversations(context.db, context.actorId, input)),
  ),
  conversation: api.conversation.handler(async ({ context, input }) =>
    unwrapResult(await service.getConversation(context.db, context.actorId, input.conversationId)),
  ),
  list: api.list.handler(async ({ context, input }) =>
    unwrapResult(await service.listMessages(context.db, context.actorId, input)),
  ),
  send: api.send.handler(async ({ context, input }) =>
    unwrapResult(await service.sendMessage(context.db, context.actorId, input)),
  ),
  markRead: api.markRead.handler(async ({ context, input }) =>
    unwrapResult(
      await service.markRead(context.db, context.actorId, input.conversationId, input.messageId),
    ),
  ),
});
