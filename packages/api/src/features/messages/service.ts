import { err, errAsync, ok, ResultAsync } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { databaseError, notFound } from "../../errors";
import { decodeCursor, toPage } from "../../pagination";
import { fileKey, fileName, servedType, type FileStore } from "./files";
import type { SendMessageInput } from "./schemas";
import * as fileRepository from "./file-repository";
import * as repository from "./repository";

export function getConversation(db: QueryDatabase, actorId: string, id: string) {
  return ResultAsync.combine([
    repository
      .findConversation(db, actorId, id)
      .andThen((row) => (row ? ok(row) : err(notFound("Conversation")))),
    repository.participants(db, actorId, id),
    repository.listMessages(db, actorId, id, 1),
  ]).map(([row, participants, messages]) => ({
    id: row.id,
    shortId: row.shortId,
    updatedAt: row.createdAt,
    canSend: row.canSend,
    unreadCount: row.unreadCount,
    readReceiptMessageId: row.readReceiptMessageId,
    participants,
    lastMessage: messages[0] ?? null,
  }));
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
            shortId: row.shortId,
            updatedAt: row.createdAt,
            canSend: row.canSend,
            unreadCount: row.unreadCount,
            readReceiptMessageId: row.readReceiptMessageId,
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
    ResultAsync.combine([
      repository
        .findConversation(db, actorId, input.conversationId)
        .andThen((row) => (row ? ok(row) : err(notFound("Conversation")))),
      repository.listMessages(db, actorId, input.conversationId, input.limit + 1, cursor),
    ]).map(([, rows]) => toPage(rows, input.limit)),
  );
}
export function sendMessage(db: QueryDatabase, actorId: string, input: SendMessageInput) {
  return repository
    .sendMessage(db, actorId, input)
    .andThen((row) =>
      row ? ok(row.id) : err(notFound("Conversation, recipients, link, files or replied message")),
    )
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

/** Stores a file under a fresh key, then stages it for the uploader's next message. */
export async function uploadFile(
  db: QueryDatabase,
  files: FileStore,
  actorId: string,
  input: { conversationId: string; file: File; width?: number; height?: number },
) {
  const allowed = await repository.canSendTo(db, actorId, input.conversationId);
  if (allowed.isErr()) return err(allowed.error);
  if (!allowed.value) return err(notFound("Conversation"));
  // The type needs only the first bytes; the file itself goes to storage as it arrived.
  const head = await ResultAsync.fromPromise(
    input.file
      .slice(0, 16)
      .arrayBuffer()
      .then((buffer) => new Uint8Array(buffer)),
    databaseError,
  );
  if (head.isErr()) return err(head.error);
  const type = servedType(head.value);
  const pixels =
    type.startsWith("image/") && input.width && input.height
      ? { width: input.width, height: input.height }
      : { width: null, height: null };
  const key = fileKey(input.conversationId);
  const stored = await ResultAsync.fromPromise(files.put(key, input.file), databaseError);
  if (stored.isErr()) {
    // Nothing references this fresh key yet, so it is always safe to discard.
    await files.delete(key).catch(() => console.warn("Message file cleanup failed."));
    return err(stored.error);
  }
  const staged = await fileRepository.stageFile(db, actorId, {
    conversationId: input.conversationId,
    objectKey: key,
    name: fileName(input.file.name),
    type,
    size: input.file.size,
    ...pixels,
  });
  if (staged.isErr()) {
    // The client never learns a failed upload's ID, so even a committed row can't be sent or
    // read, and the sweep removes it. The bytes can always go.
    await files.delete(key).catch(() => console.warn("Message file cleanup failed."));
  }
  return staged;
}

/**
 * Removes a bounded batch of abandoned uploads: rows first, so no send can use them, then
 * their bytes. A failed delete leaves an orphaned object, never a message without its file.
 */
export async function sweepStagedFiles(db: QueryDatabase, files: FileStore, limit = 50) {
  const claimed = await fileRepository.claimStagedFiles(db, limit);
  if (claimed.isErr()) return void console.warn("Message file sweep skipped:", claimed.error);
  const deletions = await Promise.allSettled(
    claimed.value.map((row) => files.delete(row.objectKey)),
  );
  const left = deletions.filter((deletion) => deletion.status === "rejected").length;
  if (left) console.warn(`Message file sweep left ${left} objects.`);
}

/** A sent file's bytes for a member of its conversation. */
export function readFile(
  db: QueryDatabase,
  files: FileStore,
  actorId: string,
  input: { conversationId: string; fileId: string },
) {
  return fileRepository
    .findSentFile(db, actorId, input.conversationId, input.fileId)
    .andThen((row) => (row ? ok(row) : err(notFound("File"))))
    .andThen((row) =>
      ResultAsync.fromPromise(files.get(row.objectKey), databaseError).andThen((body) =>
        // Named by its ID, not the name members see: WebKit fails to read a response whose
        // multipart file name has characters outside Latin-1, and clients already know the name.
        body ? ok(new File([body], input.fileId, { type: row.type })) : err(notFound("File")),
      ),
    );
}

export { unreadCount } from "./repository";
