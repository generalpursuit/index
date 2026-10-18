import { UserAvatar } from "@/components/app/user-avatar";
import type { Conversation, MessageFile, MessageReply } from "@/lib/types";

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
/** A replied message without text is named by its files or shared post. */
export function replyExcerpt(reply: MessageReply) {
  return reply.excerpt || filesSummary(reply.files) || (reply.hasAttachment ? "Shared post" : "");
}
/** What files a message without text carries: "Photo", "3 photos", a file's name or "2 files". */
export function filesSummary(files: readonly MessageFile[]) {
  if (!files.length) return "";
  const photos = files.every((file) => file.type.startsWith("image/"));
  if (files.length === 1) return photos ? "Photo" : files[0]!.name;
  return `${files.length} ${photos ? "photos" : "files"}`;
}
/** A file's kind and size, as in "PDF · 240 KB", in decimal units as Finder and iOS count. */
export function fileDetails(name: string, size: number) {
  const kind = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toUpperCase();
  const kilobytes = Math.max(1, Math.round(size / 1000));
  // Compared after rounding, so "1000 KB" never shows; it reads "1.0 MB".
  const amount = kilobytes < 1000 ? `${kilobytes} KB` : `${(size / 1000 / 1000).toFixed(1)} MB`;
  return kind ? `${kind} · ${amount}` : amount;
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
