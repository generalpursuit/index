import { UserAvatar } from "@/components/app/user-avatar";
import type { Conversation, MessageReply } from "@/lib/types";

export function conversationName(chat: Conversation, viewerId: string) {
  return (
    chat.participants
      .filter((p) => p.id !== viewerId)
      .map((p) => (chat.participants.length > 2 ? p.name.split(" ")[0] : p.name))
      .join(", ") || "Conversation"
  );
}
/** Who a reply answers, from the point of view of the person reading it. */
export function replyLabel(chat: Conversation, viewerId: string, from: string, to: string) {
  if (to !== viewerId)
    return (
      "Replying to " + (chat.participants.find((p) => p.id === to)?.name ?? "a former participant")
    );
  return from === viewerId ? "Replying to yourself" : "Replying to you";
}
/** A replied message without text was a shared post. */
export function replyExcerpt(reply: MessageReply) {
  return reply.excerpt || (reply.hasAttachment ? "Shared post" : "");
}
export function ChatAvatars({ chat, viewerId }: { chat: Conversation; viewerId: string }) {
  return (
    <span
      className={
        "avatar-stack relative inline-flex w-12 h-12 flex-none items-center [&_.user-avatar]:w-11 [&_.user-avatar]:h-11 [&:has(.user-avatar:nth-child(2))_.user-avatar]:w-7.75 [&:has(.user-avatar:nth-child(2))_.user-avatar]:h-7.75 [&:has(.user-avatar:nth-child(2))_.user-avatar]:absolute [&:has(.user-avatar:nth-child(2))_.user-avatar]:left-0 [&:has(.user-avatar:nth-child(2))_.user-avatar]:top-0 [&_.user-avatar:nth-child(2)]:left-4! [&_.user-avatar:nth-child(2)]:top-4.25! [&_.user-avatar:nth-child(2)]:[outline:2px_solid_var(--background)]"
      }
    >
      {chat.participants
        .filter((p) => p.id !== viewerId)
        .slice(0, 2)
        .map((p) => (
          <UserAvatar key={p.id} person={p} />
        ))}
    </span>
  );
}
