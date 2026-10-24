import { seedConversation } from "@/data/seeding";
import { placeholderConversation, placeholderMessages } from "@/data/placeholders";
import { ChatAvatars, conversationName, filesSummary } from "./conversation-presentation";
import { ProfileLink } from "@/components/app/profile-link";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@index/ui/components/button";
import { Input } from "@index/ui/components/input";
import { SquarePen, X, Search } from "lucide-react";
import { Heading, Back } from "@/components/app/navigation";
import { IconButton } from "@index/ui/components/icon-button";
import { Confirmation } from "@index/ui/components/confirmation";
import { QueryState, More } from "@/components/app/query-state";
import { useConversations, useConversation, useMessageActions } from "./hooks/use-messages";
import { RecipientPicker, prefetchRecipients } from "./recipient-picker";
import { useAPI, useViewer } from "@/hooks/use-api";
import { useDebounced } from "@/hooks/use-debounced";
import { useMessageDraft } from "./drafts";
import type { MessageDraft } from "./draft";
import { MessageThread } from "./message-thread";
import { Composer } from "./composer";
import { ConversationDrop, receiveDroppedText } from "./conversation-drop";
import { addDraftFiles, removeDraftFile } from "./uploads";
import { timeAgo } from "@/lib/weeks";
import type { Message, SavedLink } from "@/lib/types";

// Shared by instances in this component; markers remain available to scroll hooks/tests.
const personLabelClassName =
  "person-label [&_small]:text-subtle-foreground [&_small]:leading-[16px] [&_small]:text-[12px] [&_small]:overflow-hidden [&_small]:text-ellipsis [&_small]:whitespace-nowrap [&_strong]:font-medium [&_strong]:leading-[18px] [&_strong]:overflow-hidden [&_strong]:text-ellipsis flex flex-col min-w-0 gap-px [&_strong_svg]:inline [&_strong_svg]:align-middle";

const chatTitleClassName =
  "chat-title flex flex-col items-center gap-1.5 min-w-0 max-w-full text-center [&_strong]:max-w-full [&_strong]:truncate [&_strong]:text-[15px] [&_strong]:font-medium [&_strong]:leading-5 [&_small]:text-[12px] [&_small]:leading-4 [&_small]:text-subtle-foreground [&_small]:max-h-8 [&_small]:overflow-y-auto [@media(width<=700px)]:[&_strong]:text-[14px] [@media(width<=700px)]:[&_small]:text-[11px]";

export function MessagesPage() {
  const [query, setQuery] = useState(""),
    [picker, setPicker] = useState(false),
    list = useConversations(useDebounced(query)),
    viewer = useViewer()!,
    cache = useQueryClient(),
    api = useAPI();
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
            onPointerEnter={() => prefetchRecipients(cache, api, viewer.id)}
            onFocus={() => prefetchRecipients(cache, api, viewer.id)}
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
        placeholder={
          <>
            {[0, 1, 2].map((key) => (
              <ConversationRow key={key} placeholder />
            ))}
          </>
        }
        pending={list.isPending}
        hasData={!!list.data}
        error={list.error}
        retry={() => void list.refetch()}
      >
        <div className="conversation-list">
          {list.data?.pages
            .flatMap((p) => p.items)
            .map((chat) => (
              <ConversationRow chat={chat} viewerId={viewer.id} key={chat.id} />
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
/** Whether the reader is at the newest message, measured against a given thread height. */
const atNewest = (thread: HTMLElement, height = thread.clientHeight) =>
  thread.scrollHeight - thread.scrollTop - height < 80;
export function ConversationPage({ id, attach }: { id: string; attach?: string }) {
  const { detail, list } = useConversation(id),
    actions = useMessageActions(),
    api = useAPI(),
    cache = useQueryClient(),
    viewer = useViewer()!,
    navigate = useNavigate();
  const { draft, owner: draftOwner } = useMessageDraft(id);
  const [recovery, setRecovery] = useState<MessageDraft>();
  const attached = useQuery(
    api.links.get.queryOptions({
      input: { id: attach ?? "00000000-0000-4000-8000-000000000000" },
      enabled: !!attach,
    }),
  );
  const input = useRef<HTMLTextAreaElement>(null),
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
  const chat = detail.data ?? placeholderConversation;
  const recipient =
    detail.data?.participants.length === 2
      ? detail.data.participants.find((person) => person.id !== viewer.id)
      : undefined;
  const markRead = actions.read.mutate;
  const newest = list.data?.pages[0]?.items[0],
    lastId =
      newest && !("delivery" in newest && newest.delivery === "pending") ? newest.id : undefined;
  useEffect(() => {
    if (nearBottom.current) end.current?.scrollIntoView({ block: "end" });
    if (lastId && nearBottom.current && !document.hidden)
      markRead({ conversationId: id, messageId: lastId });
  }, [lastId, id, markRead]);
  useEffect(() => {
    input.current?.focus();
  }, [id]);
  // Replies, attachments and longer text grow the composer; the newest message stays in view.
  const shown = !!detail.data;
  useEffect(() => {
    const thread = scroller.current;
    if (!thread) return;
    let height = thread.clientHeight;
    const observer = new ResizeObserver(() => {
      // Judged by the height before this change: a scroll reported in the same frame has
      // already measured the smaller thread and counted the reader as scrolled away.
      if (atNewest(thread, height)) {
        nearBottom.current = true;
        thread.scrollTop = thread.scrollHeight;
      }
      height = thread.clientHeight;
    });
    observer.observe(thread);
    return () => observer.disconnect();
  }, [shown]);
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
  function reply(message: Message) {
    draftOwner.reply({
      id: message.id,
      senderId: message.senderId,
      excerpt: message.body,
      hasAttachment: message.hasAttachment,
      files: message.files,
    });
    input.current?.focus();
  }
  function addFiles(files: File[]) {
    addDraftFiles(draftOwner, files, api, cache);
    input.current?.focus();
  }
  async function receiveText(text: string) {
    await receiveDroppedText(draftOwner, text, api, cache);
    input.current?.focus();
  }
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
      {(chat || detail.isPending) && (
        <div
          className={"chat-page h-full flex flex-col min-h-0"}
          data-placeholder={!detail.data || undefined}
        >
          {/* Drops wait for the conversation, which the overlay names. */}
          {detail.data && (
            <ConversationDrop
              name={conversationName(detail.data, viewer.id)}
              onFiles={addFiles}
              onText={(text) => void receiveText(text)}
            />
          )}
          {/* Like Messages: who the conversation is with, centered on the page. The empty third
              column balances Back. */}
          <header
            className={
              "chat-heading grid grid-cols-[minmax(32px,_1fr)_minmax(0,_max-content)_minmax(32px,_1fr)] items-start mb-5.5 flex-none [&>[data-slot='button']]:mt-1.5 [&_.avatar-stack]:w-11 [&_.avatar-stack]:h-11 [&_.user-avatar]:w-11 [&_.user-avatar]:h-11 [@media(width<=700px)]:[&>[data-slot='button']]:mt-1 [@media(width<=700px)]:[&_.avatar-stack]:w-10 [@media(width<=700px)]:[&_.avatar-stack]:h-10 [@media(width<=700px)]:[&_.user-avatar]:w-10 [@media(width<=700px)]:[&_.user-avatar]:h-10"
            }
          >
            <Back fallback="/messages" />
            {recipient ? (
              <ProfileLink
                person={recipient}
                className={chatTitleClassName}
                aria-label={"View " + recipient.name + "’s profile"}
              >
                <ChatAvatars chat={chat} viewerId={viewer.id} />
                <strong>{recipient.name}</strong>
              </ProfileLink>
            ) : (
              <div className={chatTitleClassName}>
                <ChatAvatars chat={chat} viewerId={viewer.id} />
                <strong>{conversationName(chat, viewer.id)}</strong>
                {/* A group names each member, and each name opens that member's profile. */}
                {chat.participants.length > 2 && (
                  <small>
                    {chat.participants
                      .filter((p) => p.id !== viewer.id)
                      .map((p, i) => (
                        <span key={p.id}>
                          {i > 0 ? ", " : ""}
                          <ProfileLink person={p}>@{p.username ?? p.name}</ProfileLink>
                        </span>
                      ))}
                  </small>
                )}
              </div>
            )}
          </header>
          <div
            className={
              "chat-scroller flex-1 min-h-0 overflow-auto overscroll-contain p-[0_2px_16px]"
            }
            ref={scroller}
            onScroll={() => {
              const el = scroller.current;
              if (el) {
                nearBottom.current = atNewest(el);
                if (nearBottom.current && lastId && chat?.unreadCount && !document.hidden)
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
              placeholder={
                <MessageThread
                  messages={placeholderMessages}
                  chat={chat}
                  viewerId={viewer.id}
                  canReply={false}
                  onReply={() => {}}
                  composer={input}
                />
              }
              pending={list.isPending}
              hasData={!!list.data}
              error={list.error}
              retry={() => void list.refetch()}
            >
              <MessageThread
                messages={messages}
                chat={chat}
                viewerId={viewer.id}
                canReply={draft.status !== "sending" && draft.status !== "uncertain"}
                onReply={reply}
                composer={input}
              />
            </QueryState>
            <div ref={end} />
          </div>
          <div className={"chat-composer-area flex-none"}>
            {attached.error && <p role="alert">This attachment is unavailable.</p>}
            {(draft.status === "uncertain" || draft.status === "rejected") && (
              <p className={"field-error select-text text-[12px] text-destructive"} role="alert">
                {draft.status === "uncertain"
                  ? "Delivery is unconfirmed. Your draft is safe. Retry this message before editing."
                  : "Message was rejected. Your draft is safe. Check it and try again."}
              </p>
            )}
            {draft.files.some((file) => file.failed) && (
              <p className={"field-error select-text text-[12px] text-destructive"}>
                A file couldn’t upload. Remove it to send.
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
            <Composer
              chat={chat}
              viewerId={viewer.id}
              draft={draft}
              owner={draftOwner}
              input={input}
              onSend={() => void send()}
              onAddFiles={addFiles}
              onRemoveFile={(localId) => removeDraftFile(draftOwner, localId)}
            />
          </div>
        </div>
      )}
    </QueryState>
  );
}

function ConversationRow({
  chat = placeholderConversation,
  viewerId = "",
  placeholder = false,
}: {
  chat?: import("@/lib/types").Conversation;
  viewerId?: string;
  placeholder?: boolean;
}) {
  const cache = useQueryClient(),
    api = useAPI();
  const prepare = () => {
    if (!placeholder) seedConversation(cache, api, chat);
  };
  return (
    <Link
      data-placeholder={placeholder || undefined}
      onPointerEnter={prepare}
      onFocus={prepare}
      onPointerDown={prepare}
      className={
        "conversation-row [&>small]:text-subtle-foreground [&>small]:text-[11px] [&>small]:flex-none relative flex items-center gap-4 p-[18px_0] [&>.person-label]:flex-1"
      }
      to="/messages/$conversationId"
      params={{ conversationId: chat.shortId }}
      state={{ conversationId: chat.id }}
    >
      <ChatAvatars chat={chat} viewerId={viewerId} />
      <span className={personLabelClassName}>
        <strong>{conversationName(chat, viewerId)}</strong>
        <small>
          {chat.lastMessage?.body ||
            filesSummary(chat.lastMessage?.files ?? []) ||
            (chat.lastMessage?.restrictedAuthor
              ? "Private post"
              : chat.lastMessage?.attachment?.title) ||
            (chat.lastMessage?.hasAttachment ? "Post unavailable" : "Start the conversation")}
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
  );
}
