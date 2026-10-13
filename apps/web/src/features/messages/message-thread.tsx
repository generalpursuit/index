import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
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
import { useSwipeReply } from "./use-swipe-reply";

/**
 * Oldest-first messages as iMessage shows them: stamped sections of sender runs. The list is
 * one tab stop: the arrow keys, Home and End move between messages, and Tab leaves it.
 */
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
  // The message that takes focus when Tab enters the list, the newest until another is focused.
  const [focused, setFocused] = useState<string>();
  useEffect(() => {
    if (!highlighted) return;
    const timer = setTimeout(() => setHighlighted(undefined), 1600);
    return () => clearTimeout(timer);
  }, [highlighted]);
  const loaded = new Set(messages.map((message) => message.id));
  const showOriginal = (id: string) => {
    const original = document.getElementById("message-" + id);
    original?.focus({ preventScroll: true });
    original?.scrollIntoView({
      block: "center",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
    setHighlighted(id);
  };
  // Group chats name and picture other senders; in 1:1 chats the header already does.
  const group = chat.participants.length > 2,
    newest = messages.at(-1),
    current = focused && loaded.has(focused) ? focused : newest?.id;
  // As in iMessage, a 1:1 receipt shows only while the viewer's message is the newest.
  const read = !group && newest?.senderId === viewerId && newest.id === chat.readReceiptMessageId;
  return (
    <div role="list" aria-label="Messages" onKeyDown={moveFocus}>
      {messageTimeline(messages).map((section) => {
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
            {section.runs.map((run) => {
              const outgoing = run.senderId === viewerId,
                sender = chat.participants.find((p) => p.id === run.senderId),
                name = outgoing ? "You" : (sender?.name ?? "Former participant");
              return (
                <Run
                  key={run.messages[0]!.id}
                  run={run}
                  outgoing={outgoing}
                  sender={sender}
                  name={name}
                  named={group && !outgoing}
                  read={read && run.messages.at(-1) === newest}
                >
                  {(message, tail) => {
                    const original = message.replyTo;
                    return (
                      <MessageItem
                        message={message}
                        sender={name}
                        outgoing={outgoing}
                        current={message.id === current}
                        onFocus={() => setFocused(message.id)}
                        tail={tail}
                        quote={
                          original && (
                            <ReplyQuote
                              label={replyLabel(
                                chat,
                                viewerId,
                                message.senderId,
                                original.senderId,
                              )}
                              excerpt={replyExcerpt(original)}
                              outgoing={outgoing}
                              onShow={
                                loaded.has(original.id)
                                  ? () => showOriginal(original.id)
                                  : undefined
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
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

/** Moves focus between the messages of the list, from a message or a control inside one. */
function moveFocus(event: KeyboardEvent<HTMLElement>) {
  const list = event.currentTarget,
    target = event.target as Node;
  // Menus are portalled out of the list, though React still passes their keys through it.
  if (!list.contains(target) || event.altKey || event.ctrlKey || event.metaKey) return;
  const items = [...list.querySelectorAll<HTMLElement>('[role="listitem"]')],
    index = items.findIndex((item) => item.contains(target));
  const next = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: items.length - 1 }[
    event.key
  ];
  if (index < 0 || next === undefined) return;
  event.preventDefault();
  items[Math.min(Math.max(next, 0), items.length - 1)]!.focus();
}

function Run({
  run,
  outgoing,
  sender,
  name,
  named,
  read,
  children,
}: {
  run: MessageRun;
  outgoing: boolean;
  sender?: Conversation["participants"][number];
  name: string;
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
      {named && <small className="ml-12 mb-0.5 text-[11.5px] text-subtle-foreground">{name}</small>}
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

/**
 * A message with its reply menu (right click, long press, or the ContextMenu key or Shift+F10)
 * and swipe to reply. It is announced by sender, content and time.
 */
function MessageItem({
  message,
  sender,
  outgoing,
  current,
  onFocus,
  tail,
  quote,
  highlighted,
  canReply,
  onReply,
  composer,
}: {
  message: Message;
  sender: string;
  outgoing: boolean;
  /** Whether Tab enters the list here. */
  current: boolean;
  onFocus: () => void;
  tail: boolean;
  quote?: ReactNode;
  highlighted: boolean;
  canReply: boolean;
  onReply: () => void;
  composer: RefObject<HTMLElement | null>;
}) {
  const swipe = useSwipeReply(() => {
    if (canReply) onReply();
  });
  // The menu keeps focus while open, so replying hands it to the composer as it closes.
  const replying = useRef(false);
  const label = useId();
  // A run's tail belongs to its final bubble; a card below it is its own surface.
  const card = !!message.attachment || !!message.restrictedAuthor || message.hasAttachment;
  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) replying.current = false;
      }}
    >
      <ContextMenuTrigger
        id={"message-" + message.id}
        role="listitem"
        tabIndex={current ? 0 : -1}
        aria-labelledby={`${label}sender ${label}content ${label}time`}
        // Focus rings the bubble and card as a highlight does, which fits the thread's edges.
        className="relative min-w-0 touch-pan-y outline-hidden [&:focus-visible_.message-bubble]:[box-shadow:0_0_0_2px_var(--ring)] [&:focus-visible_.shared-post]:[box-shadow:0_0_0_2px_var(--ring)]"
        onFocus={onFocus}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.target !== event.currentTarget) return;
          // Enter opens the post a message carries, or else the original a reply quotes. The
          // arrow keys reach that original too, but nothing else reaches the post.
          const action =
            event.currentTarget.querySelector<HTMLElement>(".shared-post:is(button, a)") ??
            event.currentTarget.querySelector<HTMLElement>("button.message-quote");
          if (!action) return;
          event.preventDefault();
          action.click();
        }}
        {...swipe.handlers}
      >
        <span
          ref={swipe.icon}
          aria-hidden="true"
          className={
            "absolute left-0 top-1/2 -mt-3.5 grid place-items-center size-7 rounded-full bg-muted text-subtle-foreground opacity-0 [transition:transform_150ms_ease,_color_150ms_ease] data-[armed=true]:scale-110 data-[armed=true]:text-foreground [&>svg]:size-3.5"
          }
        >
          <Reply />
        </span>
        <div
          ref={swipe.content}
          id={label + "content"}
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
        <span id={label + "sender"} hidden>
          {sender}
        </span>
        <span id={label + "time"} hidden>
          {exactTime(message.createdAt)}
        </span>
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
      // Its message is the tab stop and leads here with Enter.
      tabIndex={-1}
      className={className + " cursor-pointer [&:hover>span:last-child]:bg-surface"}
      onClick={onShow}
    >
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}
