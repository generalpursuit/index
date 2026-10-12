import { ChatAvatars, conversationName } from "./conversation-presentation";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@index/ui/components/button";
import { Input } from "@index/ui/components/input";
import { ArrowUp, SquarePen, X, Link2, LockKeyhole, Search } from "lucide-react";
import { Heading, Back } from "@/components/app/navigation";
import { IconButton } from "@index/ui/components/icon-button";
import { Confirmation } from "@index/ui/components/confirmation";
import { QueryState, More } from "@/components/app/query-state";
import { useConversations, useConversation, useMessageActions } from "./hooks/use-messages";
import { RecipientPicker } from "./recipient-picker";
import { useAPI, useViewer } from "@/hooks/use-api";
import { useDebounced } from "@/hooks/use-debounced";
import { useMessageDraft } from "./drafts";
import type { MessageDraft } from "./draft";
import { domain } from "@/features/links/url";
import { timeAgo } from "@/lib/weeks";
import type { Message, SavedLink } from "@/lib/types";

// Shared by instances in this component; markers remain available to scroll hooks/tests.
const personLabelClassName =
  "person-label [&_small]:text-subtle-foreground [&_small]:leading-[16px] [&_small]:text-[12px] [&_small]:overflow-hidden [&_small]:text-ellipsis [&_small]:whitespace-nowrap [&_strong]:font-medium [&_strong]:leading-[18px] [&_strong]:overflow-hidden [&_strong]:text-ellipsis flex flex-col min-w-0 gap-px [&_strong_svg]:inline [&_strong_svg]:align-middle";

export function MessagesPage() {
  const [query, setQuery] = useState(""),
    [picker, setPicker] = useState(false),
    list = useConversations(useDebounced(query)),
    viewer = useViewer()!;
  return (
    <div
      className={
        "messages-page [&>.page-heading_h1]:font-serif [&>.page-heading_h1]:font-bold [&>.page-heading_h1]:[font-variation-settings:'opsz'_60] [&>.page-heading_h1]:tracking-[-0.015em] [&>.page-heading_h1]:leading-[1] [&>.page-heading_h1]:text-[clamp(44px,_5vw,_62px)] [@media(width<=700px)_and_(height<=740px)]:[&>.page-heading_h1]:text-[36px]"
      }
    >
      <Heading
        actions={
          <IconButton
            className={
              "icon-link [@media(width>=701px)]:[&.profile-settings]:hidden relative flex items-center justify-center w-11 h-11 text-foreground rounded-full [&_svg]:w-6.25 [&_svg]:h-6.25 [&_svg]:stroke-[1.7]"
            }
            label="New message"
            onClick={() => setPicker(true)}
          >
            <SquarePen />
          </IconButton>
        }
      >
        Messages
      </Heading>
      <label
        className={
          "search-field grid grid-cols-[18px_minmax(0,_1fr)] items-center gap-x-3.75 h-11 p-[0_14px] m-[0_0_20px] border border-border rounded-[10px] text-subtle-foreground [transition:border-color_150ms_ease] [&:focus-within]:border-input [&_svg]:[transition:color_150ms_ease] [&:hover_svg]:text-foreground [&:focus-within_svg]:text-foreground [&_input]:border-0 [&_input]:bg-transparent! [&_input]:[box-shadow:none]! [&_input]:rounded-none [&_input]:p-0 [&_input]:h-10.5 [&_input]:text-foreground [&_input]:text-[14px] [&_input]:min-w-0 [&_input::placeholder]:text-subtle-foreground [@media(width<=700px)]:[&_input]:text-[16px]"
        }
      >
        <Search size={18} />
        <Input
          variant="plain"
          aria-label="Search conversations"
          placeholder="Search conversations"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <QueryState
        pending={list.isPending}
        hasData={!!list.data}
        error={list.error}
        retry={() => void list.refetch()}
      >
        <div className="conversation-list">
          {list.data?.pages
            .flatMap((p) => p.items)
            .map((chat) => (
              <Link
                className={
                  "conversation-row [&>small]:text-subtle-foreground [&>small]:text-[11px] [&>small]:flex-none relative flex items-center gap-4 p-[18px_0] [&>.person-label]:flex-1"
                }
                to="/messages/$conversationId"
                params={{ conversationId: chat.shortId }}
                key={chat.id}
              >
                <ChatAvatars chat={chat} viewerId={viewer.id} />
                <span className={personLabelClassName}>
                  <strong>{conversationName(chat, viewer.id)}</strong>
                  <small>
                    {chat.lastMessage?.body ||
                      (chat.lastMessage?.restrictedAuthor
                        ? "Private post"
                        : chat.lastMessage?.attachment?.title) ||
                      (chat.lastMessage?.hasAttachment
                        ? "Post unavailable"
                        : "Start the conversation")}
                  </small>
                </span>
                <small>{chat.lastMessage ? timeAgo(chat.lastMessage.createdAt) : ""}</small>
                {chat.unreadCount > 0 && (
                  <i
                    className={
                      "unread-dot absolute w-1.5 h-1.5 right-1.75 top-1.75 bg-foreground rounded-full [box-shadow:0_0_0_3px_var(--background)]"
                    }
                  />
                )}
              </Link>
            ))}
        </div>
        {list.data?.pages[0]?.items.length === 0 && (
          <div
            className={
              "empty-box flex flex-col justify-center items-center gap-3 min-h-40 p-6 text-subtle-foreground text-center [&_a]:text-foreground [&_a:hover]:underline [&_a:hover]:underline-offset-[4px]"
            }
          >
            <p>No conversations yet</p>
          </div>
        )}
        <More
          hasNext={list.hasNextPage}
          isFetching={list.isFetchingNextPage}
          fetch={list.fetchNextPage}
        />
      </QueryState>
      {picker && <RecipientPicker onClose={() => setPicker(false)} />}
    </div>
  );
}
export function ConversationPage({ id, attach }: { id: string; attach?: string }) {
  const { detail, list } = useConversation(id),
    actions = useMessageActions(),
    api = useAPI(),
    viewer = useViewer()!,
    navigate = useNavigate();
  const { draft, owner: draftOwner } = useMessageDraft(id);
  const [recovery, setRecovery] = useState<MessageDraft>();
  const sending = draft.status === "sending";
  const locked = sending || draft.status === "uncertain";
  const attached = useQuery(
    api.links.get.queryOptions({
      input: { id: attach ?? "00000000-0000-4000-8000-000000000000" },
      enabled: !!attach,
    }),
  );
  const input = useRef<HTMLInputElement>(null),
    end = useRef<HTMLDivElement>(null),
    scroller = useRef<HTMLDivElement>(null),
    nearBottom = useRef(true);
  const queueAttachment = useEffectEvent((link: SavedLink) => {
    draftOwner.attach(link);
    input.current?.focus();
  });
  useEffect(() => {
    if (attached.data && attach) {
      queueAttachment(attached.data);
      void navigate({ to: ".", search: (old) => ({ ...old, attach: undefined }), replace: true });
    }
  }, [attached.data, attach, navigate]);
  const recipient =
    detail.data?.participants.length === 2
      ? detail.data.participants.find((person) => person.id !== viewer.id)
      : undefined;
  const markRead = actions.read.mutate;
  const newest = list.data?.pages[0]?.items[0],
    lastId = newest?.id;
  useEffect(() => {
    if (nearBottom.current) end.current?.scrollIntoView({ block: "end" });
    if (lastId && nearBottom.current && !document.hidden)
      markRead({ conversationId: id, messageId: lastId });
  }, [lastId, id, markRead]);
  useEffect(() => {
    input.current?.focus();
  }, [id]);
  useEffect(() => {
    const read = () => {
      if (lastId && nearBottom.current && !document.hidden)
        markRead({ conversationId: id, messageId: lastId });
    };
    document.addEventListener("visibilitychange", read);
    return () => document.removeEventListener("visibilitychange", read);
  }, [lastId, id, markRead]);
  useEffect(() => {
    if (!actions.send.isPending) input.current?.focus();
  }, [actions.send.isPending]);
  const messages =
    list.data?.pages
      .flatMap((p) => p.items)
      .slice()
      .reverse() ?? [];
  async function send() {
    const attempt = draftOwner.prepare();
    if (!attempt) return;
    try {
      await actions.send.mutateAsync(attempt);
      draftOwner.complete(attempt);
      nearBottom.current = true;
      input.current?.focus();
    } catch (error) {
      draftOwner.fail(attempt, error);
    }
  }
  return (
    <QueryState
      pending={detail.isPending}
      hasData={!!detail.data}
      error={detail.error}
      retry={() => void detail.refetch()}
    >
      {detail.data && (
        <div className={"chat-page h-full flex flex-col min-h-0"}>
          <header
            className={
              "chat-heading flex gap-2.5 items-center mb-5.5 flex-none [&_.avatar-stack]:w-10 [&_.avatar-stack]:h-10 [&_.user-avatar]:w-8.5 [&_.user-avatar]:h-8.5 [&_.person-label]:flex-1 [&_.person-label_small]:whitespace-normal [&_.person-label_small]:max-h-10 [&_.person-label_small]:overflow-y-auto [@media(width<=700px)]:[&_.person-label_strong]:text-[14px] [@media(width<=700px)]:[&_.person-label_small]:text-[11px]"
            }
          >
            <Back fallback="/messages" />
            {recipient ? (
              <Link
                to="/u/$username"
                params={{ username: recipient.username! }}
                aria-label={"View " + recipient.name + "’s profile"}
              >
                <ChatAvatars chat={detail.data} viewerId={viewer.id} />
              </Link>
            ) : (
              <ChatAvatars chat={detail.data} viewerId={viewer.id} />
            )}
            <div className={personLabelClassName}>
              <strong>
                {recipient ? (
                  <Link to="/u/$username" params={{ username: recipient.username! }}>
                    {recipient.name}
                  </Link>
                ) : (
                  conversationName(detail.data, viewer.id)
                )}
              </strong>
              <small>
                {detail.data.participants
                  .filter((p) => p.id !== viewer.id)
                  .map((p, i) => (
                    <span key={p.id}>
                      {i > 0 ? ", " : ""}
                      <Link to="/u/$username" params={{ username: p.username! }}>
                        @{p.username ?? p.name}
                      </Link>
                    </span>
                  ))}
              </small>
            </div>
          </header>
          <div
            className={
              "chat-scroller flex-1 min-h-0 overflow-auto overscroll-contain p-[0_2px_16px] [scrollbar-width:thin] [scrollbar-color:var(--input)_transparent]"
            }
            ref={scroller}
            onScroll={() => {
              const el = scroller.current;
              if (el) {
                nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                if (nearBottom.current && lastId && detail.data?.unreadCount && !document.hidden)
                  markRead({ conversationId: id, messageId: lastId });
              }
            }}
          >
            <More
              hasNext={list.hasNextPage}
              isFetching={list.isFetchingNextPage}
              fetch={async () => {
                const el = scroller.current,
                  old = el?.scrollHeight ?? 0;
                await list.fetchNextPage();
                requestAnimationFrame(() => {
                  if (el) el.scrollTop += el.scrollHeight - old;
                });
              }}
            />
            <QueryState
              pending={list.isPending}
              hasData={!!list.data}
              error={list.error}
              retry={() => void list.refetch()}
            >
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={
                    "message [&>small]:text-subtle-foreground [&>small]:text-[10px] [&>small]:p-[0_4px] flex flex-col items-start m-[8px_0_20px] max-w-[82%] w-max gap-1.5 [&.outgoing]:ml-auto [&.outgoing]:items-end [@media(width<=700px)]:max-w-[88%] " +
                    (message.senderId === viewer.id
                      ? "outgoing [&_.message-bubble]:bg-primary [&_.message-bubble]:text-primary-foreground [&_.message-bubble]:rounded-[19px_19px_5px_19px]"
                      : "incoming")
                  }
                >
                  {detail.data!.participants.length > 2 && message.senderId !== viewer.id && (
                    <small>
                      {detail.data!.participants.find((p) => p.id === message.senderId)?.name ??
                        "Former participant"}
                    </small>
                  )}
                  <div
                    className={
                      "message-bubble [&>p]:select-text [&>p]:whitespace-pre-wrap [&>p]:wrap-anywhere [&>p]:p-[12px_16px] rounded-[19px_19px_19px_5px] bg-muted text-foreground overflow-hidden min-w-0 max-w-full [@media(width<=700px)]:[&>p]:p-[11px_14px]"
                    }
                  >
                    <SharedPost message={message} />
                    {message.body && <p>{message.body}</p>}
                  </div>
                  <small>{timeAgo(message.createdAt)}</small>
                </div>
              ))}
            </QueryState>
            <div ref={end} />
          </div>
          <div className={"chat-composer-area flex-none"}>
            {attached.error && <p role="alert">This attachment is unavailable.</p>}
            {draft.attachment && (
              <div
                className={
                  "draft-attachment flex items-center gap-3 bg-surface border border-border rounded-[14px] p-[12px_14px] mt-3 [&>.person-label]:flex-1 [&_strong]:whitespace-nowrap [&_strong]:text-ellipsis"
                }
              >
                <Link2 />
                <div className={personLabelClassName}>
                  <strong>{draft.attachment.title}</strong>
                  <small>{domain(draft.attachment.url)}</small>
                </div>
                <IconButton
                  label="Remove attachment"
                  disabled={locked}
                  onClick={() => draftOwner.removeAttachment()}
                >
                  <X />
                </IconButton>
              </div>
            )}
            {(draft.status === "uncertain" || draft.status === "rejected") && (
              <p className={"field-error select-text text-[12px] text-destructive"} role="alert">
                {draft.status === "uncertain"
                  ? "Delivery is unconfirmed. Your draft is safe. Retry this message before editing."
                  : "Message was rejected. Your draft is safe. Check it and try again."}
              </p>
            )}
            {draft.queuedAttachment && (
              <div className="flex items-center gap-3 py-2 text-sm" role="status">
                <span className="min-w-0 flex-1">
                  For your next message: {draft.queuedAttachment.title}
                </span>
                <IconButton
                  label="Remove next attachment"
                  onClick={() => draftOwner.removeQueuedAttachment()}
                >
                  <X />
                </IconButton>
              </div>
            )}
            {draft.status === "uncertain" && (
              <Button variant="ghost" onClick={() => setRecovery(draftOwner)}>
                Start a new message
              </Button>
            )}
            <Confirmation
              open={!!recovery}
              onOpenChange={(open) => {
                if (!open) setRecovery(undefined);
              }}
              title="Discard this unconfirmed draft?"
              description="It may already have been delivered. Starting a new message won’t remove a delivered message. Your queued attachment will be kept."
              label="Discard draft"
              onConfirm={() => {
                recovery?.abandonUnconfirmed();
                setRecovery(undefined);
              }}
            />
            <form
              className={"composer flex gap-2.5 items-center pt-4"}
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <Input
                variant="composer"
                className="h-10"
                ref={input}
                disabled={locked}
                aria-label="Message"
                placeholder="Message"
                maxLength={10000}
                value={draft.body}
                onChange={(e) => draftOwner.editBody(e.target.value)}
              />
              <Button
                type="submit"
                size="icon"
                className="size-10 flex-none"
                aria-label="Send message"
                disabled={sending || (!draft.body.trim() && !draft.attachment)}
              >
                <ArrowUp />
              </Button>
            </form>
          </div>
        </div>
      )}
    </QueryState>
  );
}
function SharedPost({ message }: { message: Message }) {
  const navigate = useNavigate();
  if (message.attachment)
    return (
      <Button
        variant="ghost"
        className={
          "shared-post [&[data-slot='button']]:flex [&[data-slot='button']]:items-center [&[data-slot='button']]:gap-3 [&[data-slot='button']]:p-[18px_16px] [&[data-slot='button']]:w-full [&[data-slot='button']]:h-auto [&[data-slot='button']]:bg-surface [&[data-slot='button']]:rounded-none! [&[data-slot='button']]:whitespace-normal [&[data-slot='button']]:text-left flex items-center gap-3 p-[18px_16px] w-full h-auto bg-surface rounded-none! whitespace-normal text-left [&>svg]:flex-none [&>span]:flex [&>span]:flex-col [&>span]:gap-1 [&>span]:min-w-0 [&_strong]:font-medium [&_strong]:wrap-anywhere [&_small]:text-[11px] [&_small]:opacity-[0.7] [&_small]:wrap-anywhere [&.restricted>span>span]:text-[12px] [&.restricted>span>span]:underline [&.restricted>span>span]:underline-offset-[3px] [&.restricted>span>span]:mt-1.5"
        }
        onClick={() =>
          void navigate({
            to: ".",
            search: (old) => ({ ...old, post: message.attachment!.shortId }),
          })
        }
      >
        <Link2 />
        <span>
          <strong>{message.attachment.title}</strong>
          <small>{domain(message.attachment.url)}</small>
        </span>
      </Button>
    );
  if (message.restrictedAuthor)
    return (
      <Link
        className={
          "shared-post [&[data-slot='button']]:flex [&[data-slot='button']]:items-center [&[data-slot='button']]:gap-3 [&[data-slot='button']]:p-[18px_16px] [&[data-slot='button']]:w-full [&[data-slot='button']]:h-auto [&[data-slot='button']]:bg-surface [&[data-slot='button']]:rounded-none! [&[data-slot='button']]:whitespace-normal [&[data-slot='button']]:text-left flex items-center gap-3 p-[18px_16px] w-full h-auto bg-surface rounded-none! whitespace-normal text-left [&>svg]:flex-none [&>span]:flex [&>span]:flex-col [&>span]:gap-1 [&>span]:min-w-0 [&_strong]:font-medium [&_strong]:wrap-anywhere [&_small]:text-[11px] [&_small]:opacity-[0.7] [&_small]:wrap-anywhere [&.restricted>span>span]:text-[12px] [&.restricted>span>span]:underline [&.restricted>span>span]:underline-offset-[3px] [&.restricted>span>span]:mt-1.5 restricted"
        }
        to="/u/$username"
        params={{ username: message.restrictedAuthor.username! }}
      >
        <LockKeyhole />
        <span>
          <strong>
            Private post from @{message.restrictedAuthor.username ?? message.restrictedAuthor.name}
          </strong>
          <small>Only approved followers can view this post.</small>
          <span>View profile</span>
        </span>
      </Link>
    );
  return message.hasAttachment ? (
    <div
      className={
        "shared-post [&[data-slot='button']]:flex [&[data-slot='button']]:items-center [&[data-slot='button']]:gap-3 [&[data-slot='button']]:p-[18px_16px] [&[data-slot='button']]:w-full [&[data-slot='button']]:h-auto [&[data-slot='button']]:bg-surface [&[data-slot='button']]:rounded-none! [&[data-slot='button']]:whitespace-normal [&[data-slot='button']]:text-left flex items-center gap-3 p-[18px_16px] w-full h-auto bg-surface rounded-none! whitespace-normal text-left [&>svg]:flex-none [&>span]:flex [&>span]:flex-col [&>span]:gap-1 [&>span]:min-w-0 [&_strong]:font-medium [&_strong]:wrap-anywhere [&_small]:text-[11px] [&_small]:opacity-[0.7] [&_small]:wrap-anywhere [&.restricted>span>span]:text-[12px] [&.restricted>span>span]:underline [&.restricted>span>span]:underline-offset-[3px] [&.restricted>span>span]:mt-1.5 unavailable"
      }
    >
      <LockKeyhole />
      <span>Post unavailable</span>
    </div>
  ) : null;
}
