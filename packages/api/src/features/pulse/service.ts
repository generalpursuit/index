import { ResultAsync } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { unreadCount as activityUnread } from "../activity/repository";
import { unreadCount as messagesUnread } from "../messages/repository";
import { activityVersion, messagesVersion } from "./repository";

// Counts come from the same reads as the unread badge and the activity list, so they always agree.
export function getPulse(db: QueryDatabase, actorId: string) {
  return ResultAsync.combine([
    messagesUnread(db, actorId),
    messagesVersion(db, actorId),
    activityUnread(db, actorId),
    activityVersion(db, actorId),
  ]).map(([messages, messagesVersion, activityUnreadCount, activityVersion]) => ({
    messages: { unreadCount: messages.unreadCount, version: messagesVersion },
    activity: { unreadCount: activityUnreadCount, version: activityVersion },
  }));
}
