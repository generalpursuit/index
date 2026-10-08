import { err, errAsync, ok, ResultAsync } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { notFound } from "../../errors";
import { decodeCursor, toPage } from "../../pagination";
import type { SendMessageInput } from "./schemas";
import * as repository from "./repository";

export function getConversation(db: QueryDatabase, actorId: string, id: string) {
  return repository
    .findConversation(db, actorId, id)
    .andThen((row) => (row ? ok(row) : err(notFound("Conversation"))))
    .andThen((row) =>
      ResultAsync.combine([
        repository.participants(db, actorId, id),
        repository.listMessages(db, actorId, id, 1),
      ]).map(([participants, messages]) => ({
        id: row.id,
        updatedAt: row.createdAt,
        canSend: row.canSend,
        unreadCount: row.unreadCount,
        participants,
        lastMessage: messages[0] ?? null,
      })),
    );
}
export function createConversation(db: QueryDatabase, actorId: string, recipientIds: string[]) {
  if (recipientIds.includes(actorId))
    return errAsync({
      code: "BAD_REQUEST" as const,
      message: "Choose other people as recipients.",
    });
  return repository
    .createConversation(db, actorId, recipientIds)
    .andThen((row) => (row ? ok(row.id) : err(notFound("Recipients"))))
    .andThen((id) => getConversation(db, actorId, id));
}
export function listConversations(
  db: QueryDatabase,
  actorId: string,
  input: { limit: number; cursor?: string; query?: string },
) {
  return (input.cursor ? decodeCursor(input.cursor) : ok(undefined)).asyncAndThen((cursor) =>
    repository
      .listConversations(db, actorId, input.limit + 1, cursor, input.query)
      .andThen((rows) => {
        const page = toPage(rows, input.limit);
        const ids = page.items.map((row) => row.id);
        return ResultAsync.combine([
          repository.conversationParticipants(db, actorId, ids),
          repository.latestMessages(db, actorId, ids),
        ]).map(([members, last]) => ({
          ...page,
          items: page.items.map((row) => ({
            id: row.id,
            updatedAt: row.createdAt,
            canSend: row.canSend,
            unreadCount: row.unreadCount,
            participants: members.filter((m) => m.conversationId === row.id).map((m) => m.person),
            lastMessage: last.find((m) => m.conversationId === row.id) ?? null,
          })),
        }));
      }),
  );
}
export function listMessages(
  db: QueryDatabase,
  actorId: string,
  input: { conversationId: string; limit: number; cursor?: string },
) {
  return (input.cursor ? decodeCursor(input.cursor) : ok(undefined)).asyncAndThen((cursor) =>
    repository
      .findConversation(db, actorId, input.conversationId)
      .andThen((row) => (row ? ok(row) : err(notFound("Conversation"))))
      .andThen(() =>
        repository.listMessages(db, actorId, input.conversationId, input.limit + 1, cursor),
      )
      .map((rows) => toPage(rows, input.limit)),
  );
}
export function sendMessage(db: QueryDatabase, actorId: string, input: SendMessageInput) {
  return repository
    .sendMessage(db, actorId, input)
    .andThen((row) => (row ? ok(row.id) : err(notFound("Conversation, recipients or link"))))
    .andThen((id) => repository.listMessages(db, actorId, input.conversationId, 1, undefined, id))
    .andThen((rows) => (rows[0] ? ok(rows[0]) : err(notFound("Message"))));
}
export function markRead(
  db: QueryDatabase,
  actorId: string,
  conversationId: string,
  messageId: string,
) {
  return repository
    .markRead(db, actorId, conversationId, messageId)
    .andThen((row) => (row ? ok({ success: true as const }) : err(notFound("Message"))));
}

export { unreadCount } from "./repository";
