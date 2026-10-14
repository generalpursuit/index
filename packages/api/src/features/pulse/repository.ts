import {
  activities,
  comments,
  conversationMembers,
  conversations,
  links,
  messages,
} from "@index/db/schema/app";
import { user } from "@index/db/schema/auth";
import { and, desc, eq, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { linkVisible } from "../../data-access/visibility";
import { databaseError } from "../../errors";
import { activitySelection, activityVisible } from "../activity/repository";
import { conversationSelection, isMember, messageSelection } from "../messages/repository";
import { publicUserSelection } from "../profiles/repository";

type Selection = { [key: string]: SQLWrapper | Selection };

// Versions cover the largest first page a client can request, so a pulse costs the same however
// long an inbox grows. Changes further down reach clients when they load those pages.
const firstPage = 100;

// Fingerprint the same fields as the lists, so joins and visibility changes cannot
// silently leave cached summaries stale. Ordering makes identical reads stable.
function selectionJson(selection: Selection): SQL {
  return sql`jsonb_build_object(${sql.join(
    Object.entries(selection).flatMap(([key, value]) => [
      sql`${key}::text`,
      typeof value.getSQL === "function"
        ? (value as SQLWrapper)
        : selectionJson(value as Selection),
    ]),
    sql`,`,
  )})`;
}

const fingerprint = (state: SQLWrapper) =>
  sql<string>`md5(coalesce(string_agg(md5(${state}::text),'' order by place),''))`;

export function messagesVersion(db: QueryDatabase, actorId: string) {
  const members = db
    .select({ state: selectionJson(publicUserSelection).as("state"), id: user.id })
    .from(conversationMembers)
    .innerJoin(user, eq(user.id, conversationMembers.userId))
    .where(eq(conversationMembers.conversationId, conversations.id));
  const lastMessage = db
    .select({ state: selectionJson(messageSelection(actorId)).as("state") })
    .from(messages)
    .leftJoin(links, and(eq(links.id, messages.linkId), linkVisible(actorId)))
    .where(eq(messages.conversationId, conversations.id))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(1);
  const inbox = db.$with("pulse_inbox").as(
    db
      .select({
        place:
          sql<number>`row_number() over (order by ${conversations.updatedAt} desc, ${conversations.id} desc)`.as(
            "place",
          ),
        state: sql`jsonb_build_object(
          'conversation', ${selectionJson(conversationSelection(actorId))},
          'participants', (select jsonb_agg(member.state order by member.id) from (${members}) member),
          'lastMessage', (select last.state from (${lastMessage}) last)
        )`.as("state"),
      })
      .from(conversations)
      .where(isMember(actorId, conversations.id))
      .orderBy(desc(conversations.updatedAt), desc(conversations.id))
      .limit(firstPage),
  );
  return ResultAsync.fromPromise(
    db
      .with(inbox)
      .select({ version: fingerprint(inbox.state) })
      .from(inbox)
      .then((rows) => rows[0]!.version),
    databaseError,
  );
}

export function activityVersion(db: QueryDatabase, actorId: string) {
  const page = db.$with("pulse_activity").as(
    db
      .select({
        place:
          sql<number>`row_number() over (order by ${activities.createdAt} desc, ${activities.id} desc)`.as(
            "place",
          ),
        state: selectionJson(activitySelection).as("state"),
      })
      .from(activities)
      .innerJoin(user, eq(user.id, activities.actorId))
      .leftJoin(comments, eq(comments.id, activities.commentId))
      .where(activityVisible(actorId))
      .orderBy(desc(activities.createdAt), desc(activities.id))
      .limit(firstPage),
  );
  return ResultAsync.fromPromise(
    db
      .with(page)
      .select({ version: fingerprint(page.state) })
      .from(page)
      .then((rows) => rows[0]!.version),
    databaseError,
  );
}
