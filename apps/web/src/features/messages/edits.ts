import { mapItems } from "@/data/edits";

/** An acknowledgement of an older message cannot clear a newer arrival. */
export function acknowledgeConversation(data: unknown, conversationId: string, messageId: string) {
  return mapItems(
    data,
    (item) => item.id === conversationId && "participants" in item,
    (item) => {
      const newest = item.lastMessage as { id: string } | null;
      return { ...item, unreadCount: !newest || newest.id === messageId ? 0 : item.unreadCount };
    },
  );
}
