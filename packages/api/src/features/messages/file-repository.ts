/** The `message_files` queries: staging uploads, reading sent files and claiming abandoned ones. */
import { messageFiles, messages } from "@index/db/schema/app";
import { and, eq, sql } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { databaseError } from "../../errors";
import { isMember } from "./repository";

type StagedFile = {
  conversationId: string;
  objectKey: string;
  name: string;
  type: string;
  size: number;
  width: number | null;
  height: number | null;
};
const fileSelection = {
  id: messageFiles.id,
  name: messageFiles.name,
  type: messageFiles.type,
  size: messageFiles.size,
  width: messageFiles.width,
  height: messageFiles.height,
};
/** Records an uploaded file for its uploader to send; no message carries it yet. */
export function stageFile(db: QueryDatabase, actorId: string, file: StagedFile) {
  return ResultAsync.fromPromise(
    db
      .insert(messageFiles)
      .values({ ...file, uploaderId: actorId })
      .returning(fileSelection)
      .then((rows) => rows[0]!),
    databaseError,
  );
}
/** A sent file the actor can read as a member of its conversation. */
export function findSentFile(
  db: QueryDatabase,
  actorId: string,
  conversationId: string,
  fileId: string,
) {
  return ResultAsync.fromPromise(
    db
      .select({
        objectKey: messageFiles.objectKey,
        type: messageFiles.type,
      })
      .from(messageFiles)
      .innerJoin(messages, eq(messages.id, messageFiles.messageId))
      .where(
        and(
          eq(messageFiles.id, fileId),
          eq(messages.conversationId, conversationId),
          isMember(actorId, messages.conversationId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]),
    databaseError,
  );
}
/**
 * Forgets a batch of staged files nobody sent within a day, returning their object keys. The
 * outer `message_id is null` is rechecked on rows a concurrent send just claimed, so a file
 * that was sent meanwhile is never taken.
 */
export function claimStagedFiles(db: QueryDatabase, limit: number) {
  const claimed = db.$with("claimed_files", { objectKey: sql<string>`object_key`.as("object_key") })
    .as(sql`
 delete from message_files where message_id is null and id in (
   select id from message_files where message_id is null and created_at < now() - interval '1 day'
   order by created_at limit ${limit}
 ) returning object_key
 `);
  return ResultAsync.fromPromise(
    db
      .with(claimed)
      .select({ objectKey: sql<string>`object_key` })
      .from(claimed),
    databaseError,
  );
}
