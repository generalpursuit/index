import { comments, links } from "@index/db/schema/app";
import { user } from "@index/db/schema/auth";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { timestamp } from "../../data-access/timestamp";
import { linkVisible } from "../../data-access/visibility";
import { databaseError } from "../../errors";
import type { Cursor } from "../../pagination";
import { publicUserSelection } from "../profiles/repository";
import { mentionedUsernames } from "./mentions";

const selection = {
  id: comments.id,
  linkId: comments.linkId,
  authorId: comments.authorId,
  body: comments.body,
  createdAt: timestamp(comments.createdAt),
  updatedAt: timestamp(comments.updatedAt),
};

// Both creation and editing produce one event per recipient in the same SQL statement.
// Keep read timestamps on edits; removing a mention also removes its notification.
function commentNotices(db: QueryDatabase, body: string) {
  const mentioned = inArray(sql`recipient.username`, mentionedUsernames(body));
  const recipients = db.$with("comment_recipients", {}).as(sql`
    select recipient.id as recipient_id, c.author_id as actor_id,
      case when ${mentioned} then 'mention' else 'comment' end as type,
      c.link_id, c.id as comment_id
    from changed_comment c join links on links.id = c.link_id
    join "user" recipient on (recipient.id = links.owner_id or ${mentioned})
    where recipient.id <> c.author_id and ${linkVisible(sql`recipient.id`)}
  `);
  const removed = db.$with("removed_notices", {}).as(sql`
    delete from activities a using changed_comment c
    where a.comment_id = c.id and not exists (
      select 1 from comment_recipients r where r.recipient_id = a.recipient_id
    ) returning a.id
  `);
  const notice = db.$with("comment_notice", {}).as(sql`
    insert into activities(recipient_id, actor_id, type, link_id, comment_id)
    select recipient_id, actor_id, type, link_id, comment_id from comment_recipients
    on conflict (comment_id, recipient_id) where comment_id is not null
    do update set type = excluded.type
    returning id
  `);
  return [recipients, removed, notice] as const;
}

export function createComment(db: QueryDatabase, actorId: string, linkId: string, body: string) {
  const inserted = db.$with("changed_comment").as(
    db
      .insert(comments)
      .select(
        db
          .select({
            id: sql<string>`gen_random_uuid()`.as("id"),
            linkId: links.id,
            authorId: sql<string>`${actorId}`.as("author_id"),
            body: sql<string>`${body}`.as("body"),
            createdAt: sql<Date>`now()`.as("created_at"),
            updatedAt: sql<Date>`now()`.as("updated_at"),
          })
          .from(links)
          .where(and(eq(links.id, linkId), linkVisible(actorId))),
      )
      .returning(),
  );
  return ResultAsync.fromPromise(
    db
      .with(inserted, ...commentNotices(db, body))
      .select({
        id: inserted.id,
        linkId: inserted.linkId,
        authorId: inserted.authorId,
        body: inserted.body,
        createdAt: timestamp(inserted.createdAt),
        updatedAt: timestamp(inserted.updatedAt),
      })
      .from(inserted)
      .then((rows) => rows[0]),
    databaseError,
  );
}

export function listComments(
  db: QueryDatabase,
  viewerId: string | null,
  linkId: string,
  limit: number,
  cursor?: Cursor,
) {
  return ResultAsync.fromPromise(
    db
      .select({ ...selection, author: publicUserSelection })
      .from(comments)
      .innerJoin(links, eq(links.id, comments.linkId))
      .innerJoin(user, eq(user.id, comments.authorId))
      .where(
        and(
          eq(comments.linkId, linkId),
          linkVisible(viewerId),
          cursor
            ? sql`(${comments.createdAt}, ${comments.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(comments.createdAt), desc(comments.id))
      .limit(limit),
    databaseError,
  );
}

export function updateComment(db: QueryDatabase, actorId: string, id: string, body: string) {
  const updated = db.$with("changed_comment").as(
    db
      .update(comments)
      .set({ body })
      .where(
        and(
          eq(comments.id, id),
          eq(comments.authorId, actorId),
          inArray(
            comments.linkId,
            db.select({ id: links.id }).from(links).where(linkVisible(actorId)),
          ),
        ),
      )
      .returning(),
  );
  return ResultAsync.fromPromise(
    db
      .with(updated, ...commentNotices(db, body))
      .select({
        id: updated.id,
        linkId: updated.linkId,
        authorId: updated.authorId,
        body: updated.body,
        createdAt: timestamp(updated.createdAt),
        updatedAt: timestamp(updated.updatedAt),
      })
      .from(updated)
      .then((rows) => rows[0]),
    databaseError,
  );
}

export function deleteComment(db: QueryDatabase, actorId: string, id: string) {
  return ResultAsync.fromPromise(
    db
      .delete(comments)
      .where(
        and(
          eq(comments.id, id),
          or(
            eq(comments.authorId, actorId),
            inArray(
              comments.linkId,
              db.select({ id: links.id }).from(links).where(eq(links.ownerId, actorId)),
            ),
          ),
        ),
      )
      .returning({ id: comments.id })
      .then((rows) => rows[0]),
    databaseError,
  );
}
