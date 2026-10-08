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

const selection = {
  id: comments.id,
  linkId: comments.linkId,
  authorId: comments.authorId,
  body: comments.body,
  createdAt: timestamp(comments.createdAt),
  updatedAt: timestamp(comments.updatedAt),
};

export function createComment(db: QueryDatabase, actorId: string, linkId: string, body: string) {
  const inserted = db.$with("new_comment").as(
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
  const notice = db.$with("comment_notice", {}).as(sql`
 insert into activities(recipient_id,actor_id,type,link_id,comment_id)
 select l.owner_id,c.author_id,'comment',c.link_id,c.id from new_comment c join links l on l.id=c.link_id
 where l.owner_id<>c.author_id returning id`);
  return ResultAsync.fromPromise(
    db
      .with(inserted, notice)
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
  return ResultAsync.fromPromise(
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
      .returning(selection)
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
