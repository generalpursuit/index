import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Copy, Reply } from "lucide-react";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@index/ui/components/context-menu";
import { UserAvatar } from "@/components/app/user-avatar";
import type { Conversation, Message } from "@/lib/types";
import { replyExcerpt, replyLabel } from "./conversation-presentation";
import { SharedPost } from "./shared-post";
import { exactTime, messageTimeline, stampLabel, type MessageRun } from "./timeline";

/** Oldest-first messages as iMessage shows them: stamped sections of sender runs. */
export function MessageThread({
  messages,
  chat,
  viewerId,
  canReply,
  onReply,
  composer,
}: {
  messages: Message[];
  chat: Conversation;
  viewerId: string;
  canReply: boolean;
  onReply: (message: Message) => void;
  /** Where focus goes after replying from a message's menu. */
  composer: RefObject<HTMLElement | null>;
}) {
  const [highlighted, setHighlighted] = useState<string>();
  useEffect(() => {
    if (!highlighted) return;
    const timer = setTimeout(() => setHighlighted(undefined), 1600);
    return () => clearTimeout(timer);
  }, [highlighted]);
  const loaded = new Set(messages.map((message) => message.id));
  const showOriginal = (id: string) => {
    document.getElementById("message-" + id)?.scrollIntoView({
      block: "center",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
    setHighlighted(id);
  };
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
          >
            {(message, tail) => {
              const original = message.replyTo;
              return (
                <MessageItem
                  message={message}
                  outgoing={run.senderId === viewerId}
                  tail={tail}
                  quote={
                    original && (
                      <ReplyQuote
                        label={replyLabel(chat, viewerId, message.senderId, original.senderId)}
                        excerpt={replyExcerpt(original)}
                        outgoing={run.senderId === viewerId}
                        onShow={
                          loaded.has(original.id) ? () => showOriginal(original.id) : undefined
                        }
                      />
                    )
                  }
                  highlighted={highlighted === message.id}
                  canReply={canReply}
                  onReply={() => onReply(message)}
                  composer={composer}
                />
              );
            }}
          </Run>
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
  children,
}: {
  run: MessageRun;
  outgoing: boolean;
  sender?: Conversation["participants"][number];
  named: boolean;
  read: boolean;
  children: (message: Message, tail: boolean) => ReactNode;
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
            {children(message, last)}
          </div>
        );
      })}
      {read && (
        <small className="message-receipt text-[11px] text-subtle-foreground pr-1">Read</small>
      )}
    </div>
  );
}

/** A message with its reply menu, opened by right click or long press. */
function MessageItem({
  message,
  outgoing,
  tail,
  quote,
  highlighted,
  canReply,
  onReply,
  composer,
}: {
  message: Message;
  outgoing: boolean;
  tail: boolean;
  quote?: ReactNode;
  highlighted: boolean;
  canReply: boolean;
  onReply: () => void;
  composer: RefObject<HTMLElement | null>;
}) {
  // The menu keeps focus while open, so replying hands it to the composer as it closes.
  const replying = useRef(false);
  // A run's tail belongs to its final bubble; a card below it is its own surface.
  const card = !!message.attachment || !!message.restrictedAuthor || message.hasAttachment;
  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) replying.current = false;
      }}
    >
      <ContextMenuTrigger className="relative min-w-0">
        <div
          id={"message-" + message.id}
          className={
            "message relative flex flex-col gap-0.5 min-w-0 [&[data-highlighted]_.message-bubble]:[box-shadow:0_0_0_2px_var(--ring)] [&[data-highlighted]_.shared-post]:[box-shadow:0_0_0_2px_var(--ring)] " +
            (outgoing ? "outgoing items-end" : "incoming items-start")
          }
          data-highlighted={highlighted || undefined}
          title={exactTime(message.createdAt)}
        >
          {quote}
          {message.body && (
            <p
              className={
                // Touch screens copy from the menu, since a long press opens it.
                "message-bubble max-w-full p-[8px_13px] rounded-[18px] leading-[1.35] [@media(pointer:fine)]:select-text whitespace-pre-wrap wrap-anywhere " +
                (outgoing ? "bg-primary text-primary-foreground" : "bg-muted text-foreground") +
                (tail && !card ? (outgoing ? " rounded-br-[5px]" : " rounded-bl-[5px]") : "")
              }
            >
              {message.body}
            </p>
          )}
          <SharedPost message={message} />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent finalFocus={() => (replying.current ? composer.current : true)}>
        <ContextMenuItem
          disabled={!canReply}
          onClick={() => {
            replying.current = true;
            onReply();
          }}
        >
          <Reply />
          Reply
        </ContextMenuItem>
        {message.body && (
          <ContextMenuItem
            onClick={() =>
              void navigator.clipboard
                .writeText(message.body)
                .catch(() => toast.error("Could not copy this message. Try again."))
            }
          >
            <Copy />
            Copy
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** The replied message above a reply; it leads back to the original when that is loaded. */
function ReplyQuote({
  label,
  excerpt,
  outgoing,
  onShow,
}: {
  label: string;
  excerpt: string;
  outgoing: boolean;
  onShow?: () => void;
}) {
  const className =
    "message-quote flex flex-col gap-0.5 max-w-full mb-0.5 text-left text-[11.5px] text-subtle-foreground rounded-[14px] outline-none focus-visible:outline-2 focus-visible:outline-ring [&>span]:max-w-full [&>span:first-child]:px-1 [&>span:last-child]:p-[5px_11px] [&>span:last-child]:border [&>span:last-child]:border-border [&>span:last-child]:rounded-[14px] [&>span:last-child]:text-[13px] [&>span:last-child]:leading-[1.35] [&>span:last-child]:text-muted-foreground [&>span:last-child]:line-clamp-2 [&>span:last-child]:wrap-anywhere " +
    (outgoing ? "items-end" : "items-start");
  const content = (
    <>
      <span>{label}</span>
      <span>{excerpt}</span>
    </>
  );
  return onShow ? (
    <button
      type="button"
      className={className + " cursor-pointer [&:hover>span:last-child]:bg-surface"}
      onClick={onShow}
    >
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}
