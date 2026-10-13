import { conversationMembers, conversations, messages, links } from "@index/db/schema/app";
import type { z } from "zod";
import type { publicUserSchema } from "../profiles/schemas";
import { user } from "@index/db/schema/auth";
import { and, desc, eq, inArray, sql, type SQLWrapper } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { timestamp } from "../../data-access/timestamp";
import { linkLocked, linkVisible } from "../../data-access/visibility";
import { databaseError } from "../../errors";
import type { Cursor } from "../../pagination";
import { linkSelection, collectionSelection } from "../links/repository";
import { publicUserSelection } from "../profiles/repository";
import type { SendMessageInput } from "./schemas";

function isMember(actorId: string, conversationId: SQLWrapper) {
  return sql<boolean>`exists(select 1 from conversation_members member where member.conversation_id=${conversationId} and member.user_id=${actorId})`;
}
function canSend(actorId: string, conversationId: SQLWrapper) {
  return isMember(actorId, conversationId);
}
export function createConversation(db: QueryDatabase, actorId: string, recipientIds: string[]) {
  const memberKey = JSON.stringify([actorId, ...recipientIds].sort());
  const created = db.$with("created_conversation", { id: sql<string>`id`.as("id") }).as(sql`
 insert into conversations(member_key)
 select ${memberKey} where not exists (
   select 1 from jsonb_array_elements_text(${JSON.stringify(recipientIds)}::jsonb) recipient(id)
   where not exists(select 1 from follows f where f.follower_id=${actorId} and f.followed_id=recipient.id and f.status='accepted')
 ) on conflict(member_key) do update set member_key=excluded.member_key
 returning id
 `);
  const members = db.$with("created_members", {}).as(sql`
 insert into conversation_members(conversation_id,user_id)
 select c.id,m.id from created_conversation c cross join jsonb_array_elements_text(${memberKey}::jsonb) m(id)
 on conflict do nothing returning conversation_id
 `);
  return ResultAsync.fromPromise(
    db
      .with(created, members)
      .select({ id: sql<string>`id` })
      .from(created)
      .then((rows) => rows[0]),
    databaseError,
  );
}
const conversationSelection = (actorId: string) => ({
  id: conversations.id,
  shortId: conversations.shortId,
  // The shared cursor uses createdAt internally; inbox ordering uses last activity.
  createdAt: timestamp(conversations.updatedAt),
  canSend: canSend(actorId, sql`"conversations"."id"`),
  unreadCount: sql<number>`(select count(*)::int from messages m join conversation_members cm on cm.conversation_id=m.conversation_id and cm.user_id=${actorId}
 where m.conversation_id="conversations"."id" and m.sender_id<>${actorId}
 and (cm.read_at is null or (m.created_at,m.id)>(cm.read_at,cm.read_message_id)))`,
  // The actor's newest message at or below every other member's read watermark.
  readReceiptMessageId: sql<string | null>`(select m.id from messages m
 where m.conversation_id="conversations"."id" and m.sender_id=${actorId}
 and (m.created_at,m.id) <= all (select o.read_at,o.read_message_id from conversation_members o
   where o.conversation_id=m.conversation_id and o.user_id<>${actorId})
 order by m.created_at desc,m.id desc limit 1)`,
});
export function findConversation(db: QueryDatabase, actorId: string, id: string) {
  return ResultAsync.fromPromise(
    db
      .select(conversationSelection(actorId))
      .from(conversations)
      .where(and(eq(conversations.id, id), isMember(actorId, conversations.id)))
      .limit(1)
      .then((rows) => rows[0]),
    databaseError,
  );
}
export function listConversations(
  db: QueryDatabase,
  actorId: string,
  limit: number,
  cursor?: Cursor,
  query?: string,
) {
  const pattern = query ? `%${query.replace(/[\\%_]/g, "\\$&")}%` : undefined;
  return ResultAsync.fromPromise(
    db
      .select(conversationSelection(actorId))
      .from(conversations)
      .where(
        and(
          isMember(actorId, conversations.id),
          pattern
            ? sql`exists(select 1 from conversation_members cm join "user" u on u.id=cm.user_id where cm.conversation_id=${conversations.id} and cm.user_id<>${actorId} and (u.name ilike ${pattern} or u.username ilike ${pattern}))`
            : undefined,
          cursor
            ? sql`(${conversations.updatedAt},${conversations.id}) < (${cursor.createdAt}::timestamptz,${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(conversations.updatedAt), desc(conversations.id))
      .limit(limit),
    databaseError,
  );
}
export function participants(db: QueryDatabase, actorId: string, id: string) {
  return ResultAsync.fromPromise(
    db
      .select(publicUserSelection)
      .from(user)
      .innerJoin(conversationMembers, eq(conversationMembers.userId, user.id))
      .where(
        and(
          eq(conversationMembers.conversationId, id),
          isMember(actorId, conversationMembers.conversationId),
        ),
      )
      .orderBy(user.id),
    databaseError,
  );
}
const messageSelection = (actorId: string) => ({
  id: messages.id,
  conversationId: messages.conversationId,
  senderId: messages.senderId,
  clientId: messages.clientId,
  body: messages.body,
  createdAt: timestamp(messages.createdAt),
  attachment: { ...linkSelection, ...collectionSelection(actorId) },
  hasAttachment: messages.hasAttachment,
  // Only public profile identity is exposed, never original-link metadata.
  restrictedAuthor: sql<z.output<typeof publicUserSchema> | null>`(
    select jsonb_build_object('id',u.id,'name',u.name,'username',u.username,
      'image',u.image,'profileVisibility',u.profile_visibility)
    from links original left join groups g on g.id=original.group_id join "user" u on u.id=original.owner_id
    where original.id=${messages.linkId} and ${links.id} is null
      and (g.id is null or g.visibility='public') and u.profile_visibility='private'
  )`,
});

export function listMessages(
  db: QueryDatabase,
  actorId: string,
  id: string,
  limit: number,
  cursor?: Cursor,
  messageId?: string,
) {
  return ResultAsync.fromPromise(
    db
      .select(messageSelection(actorId))
      .from(messages)
      .leftJoin(links, and(eq(links.id, messages.linkId), linkVisible(actorId)))
      .where(
        and(
          eq(messages.conversationId, id),
          isMember(actorId, messages.conversationId),
          messageId ? eq(messages.id, messageId) : undefined,
          cursor
            ? sql`(${messages.createdAt},${messages.id}) < (${cursor.createdAt}::timestamptz,${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(limit),
    databaseError,
  );
}
export function sendMessage(db: QueryDatabase, actorId: string, input: SendMessageInput) {
  // Only the sender must see an unlocked original. Readers retain their own access.
  const attachmentAllowed = input.linkId
    ? sql`exists (
      select 1 from links where links.id=${input.linkId}::uuid and ${linkVisible(actorId)}
      and not ${linkLocked()}
    )`
    : sql`true`;
  const inserted = db.$with("sent_message", { id: sql<string>`id`.as("id") }).as(sql`
 insert into messages(conversation_id,sender_id,client_id,body,link_id,has_attachment)
 select ${input.conversationId}::uuid,${actorId},${input.clientId}::uuid,${input.body},${input.linkId ?? null}::uuid,${!!input.linkId}
 where ${canSend(actorId, sql`${input.conversationId}::uuid`)} and ${attachmentAllowed}
 on conflict(sender_id,client_id) do update set client_id=excluded.client_id
 where messages.conversation_id=excluded.conversation_id and messages.body=excluded.body and messages.link_id is not distinct from excluded.link_id
 returning id,conversation_id,created_at
 `);
  const touched = db.$with("touched_conversation", {}).as(sql`
 update conversations c set updated_at=greatest(c.updated_at,m.created_at) from sent_message m where c.id=m.conversation_id returning c.id
 `);
  return ResultAsync.fromPromise(
    db
      .with(inserted, touched)
      .select({ id: sql<string>`id` })
      .from(inserted)
      .then((rows) => rows[0]),
    databaseError,
  );
}
export function markRead(
  db: QueryDatabase,
  actorId: string,
  conversationId: string,
  messageId: string,
) {
  const updated = db.$with("read_member", {}).as(sql`
 update conversation_members cm set read_at=m.created_at,read_message_id=m.id from messages m
 where cm.user_id=${actorId} and cm.conversation_id=${conversationId}::uuid
 and m.conversation_id=cm.conversation_id and m.id=${messageId}::uuid
 and (cm.read_at is null or (cm.read_at,cm.read_message_id)<(m.created_at,m.id))
 returning cm.user_id
 `);
  return ResultAsync.fromPromise(
    db
      .with(updated)
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.conversationId, conversationId),
          isMember(actorId, messages.conversationId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]),
    databaseError,
  );
}

export function conversationParticipants(db: QueryDatabase, actorId: string, ids: string[]) {
  return ResultAsync.fromPromise(
    db
      .select({ conversationId: conversationMembers.conversationId, person: publicUserSelection })
      .from(conversationMembers)
      .innerJoin(user, eq(user.id, conversationMembers.userId))
      .where(
        and(
          inArray(conversationMembers.conversationId, ids),
          isMember(actorId, conversationMembers.conversationId),
        ),
      )
      .orderBy(user.id),
    databaseError,
  );
}
export function latestMessages(db: QueryDatabase, actorId: string, ids: string[]) {
  return ResultAsync.fromPromise(
    db
      .selectDistinctOn([messages.conversationId], messageSelection(actorId))
      .from(messages)
      .leftJoin(links, and(eq(links.id, messages.linkId), linkVisible(actorId)))
      .where(and(inArray(messages.conversationId, ids), isMember(actorId, messages.conversationId)))
      .orderBy(messages.conversationId, desc(messages.createdAt), desc(messages.id)),
    databaseError,
  );
}

export function unreadCount(db: QueryDatabase, actorId: string) {
  return ResultAsync.fromPromise(
    db
      .select({ unreadCount: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(
        conversationMembers,
        and(
          eq(conversationMembers.conversationId, messages.conversationId),
          eq(conversationMembers.userId, actorId),
        ),
      )
      .where(
        sql`${messages.senderId}<>${actorId} and (${conversationMembers.readAt} is null or (${messages.createdAt},${messages.id})>(${conversationMembers.readAt},${conversationMembers.readMessageId}))`,
      )
      .then((rows) => rows[0]!),
    databaseError,
  );
}
