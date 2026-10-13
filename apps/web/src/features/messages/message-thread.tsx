import { UserAvatar } from "@/components/app/user-avatar";
import type { Conversation, Message } from "@/lib/types";
import { SharedPost } from "./shared-post";
import { exactTime, messageTimeline, stampLabel, type MessageRun } from "./timeline";

/** Oldest-first messages as iMessage shows them: stamped sections of sender runs. */
export function MessageThread({
  messages,
  chat,
  viewerId,
}: {
  messages: Message[];
  chat: Conversation;
  viewerId: string;
}) {
  // Group chats name and picture other senders; in 1:1 chats the header already does.
  const group = chat.participants.length > 2,
    newest = messages.at(-1);
  // As in iMessage, a 1:1 receipt shows only while the viewer's message is the newest.
  const read = !group && newest?.senderId === viewerId && newest.id === chat.readReceiptMessageId;
  return messageTimeline(messages).map((section) => {
    const stamp = stampLabel(section.at);
    return (
      <section key={section.runs[0]!.messages[0]!.id} className="message-section">
        <time
          className={
            "message-stamp block text-center text-[11.5px] text-subtle-foreground m-[18px_0_10px] [&_b]:font-semibold"
          }
          dateTime={section.at}
          title={exactTime(section.at)}
        >
          <b>{stamp.day}</b> {stamp.time}
        </time>
        {section.runs.map((run) => (
          <Run
            key={run.messages[0]!.id}
            run={run}
            outgoing={run.senderId === viewerId}
            sender={chat.participants.find((p) => p.id === run.senderId)}
            named={group && run.senderId !== viewerId}
            read={read && run.messages.at(-1) === newest}
          />
        ))}
      </section>
    );
  });
}

function Run({
  run,
  outgoing,
  sender,
  named,
  read,
}: {
  run: MessageRun;
  outgoing: boolean;
  sender?: Conversation["participants"][number];
  named: boolean;
  read: boolean;
}) {
  return (
    <div
      className={
        "message-run flex flex-col gap-0.5 mb-3 " +
        (outgoing ? "outgoing items-end" : "incoming items-start")
      }
    >
      {named && (
        <small className="ml-12 mb-0.5 text-[11.5px] text-subtle-foreground">
          {sender?.name ?? "Former participant"}
        </small>
      )}
      {run.messages.map((message, index) => {
        const last = index === run.messages.length - 1;
        return (
          <div
            key={message.id}
            className={
              "flex items-end gap-2 min-w-0 max-w-[82%] [@media(width<=700px)]:max-w-[88%] [&_.user-avatar]:size-7 [&_.user-avatar_[data-slot='avatar-fallback']]:text-[11px]"
            }
          >
            {named &&
              (last && sender ? (
                <UserAvatar person={sender} />
              ) : (
                <span className="w-7 flex-none" aria-hidden="true" />
              ))}
            <MessageContent message={message} outgoing={outgoing} tail={last} />
          </div>
        );
      })}
      {read && (
        <small className="message-receipt text-[11px] text-subtle-foreground pr-1">Read</small>
      )}
    </div>
  );
}

function MessageContent({
  message,
  outgoing,
  tail,
}: {
  message: Message;
  outgoing: boolean;
  tail: boolean;
}) {
  // A run's tail belongs to its final bubble; a card below it is its own surface.
  const card = !!message.attachment || !!message.restrictedAuthor || message.hasAttachment;
  return (
    <div
      id={"message-" + message.id}
      className={
        "message flex flex-col gap-0.5 min-w-0 " +
        (outgoing ? "outgoing items-end" : "incoming items-start")
      }
      title={exactTime(message.createdAt)}
    >
      {message.body && (
        <p
          className={
            "message-bubble max-w-full p-[8px_13px] rounded-[18px] leading-[1.35] select-text whitespace-pre-wrap wrap-anywhere " +
            (outgoing ? "bg-primary text-primary-foreground" : "bg-muted text-foreground") +
            (tail && !card ? (outgoing ? " rounded-br-[5px]" : " rounded-bl-[5px]") : "")
          }
        >
          {message.body}
        </p>
      )}
      <SharedPost message={message} />
    </div>
  );
}
