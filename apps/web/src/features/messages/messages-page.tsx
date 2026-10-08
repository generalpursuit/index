import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@index/ui/components/button";
import { Input } from "@index/ui/components/input";
import { ArrowUp, SquarePen, X, Link2, LockKeyhole, Search } from "lucide-react";
import {
  Heading,
  Back,
  IconButton,
  UserAvatar,
  QueryState,
  More,
} from "@/components/app/primitives";
import { useConversations, useConversation, useMessageActions } from "./hooks/use-messages";
import { RecipientPicker, conversationName } from "./recipient-picker";
import { useAPI, useViewer } from "@/hooks/use-api";
import { useDebounced } from "@/hooks/use-debounced";
import { useDraft } from "@/hooks/use-draft";
import { domain } from "@/features/links/link-row";
import { timeAgo } from "@/lib/weeks";
import type { Message, SavedLink, Conversation } from "@/lib/types";
export function ChatAvatars({ chat, viewerId }: { chat: Conversation; viewerId: string }) {
  return (
    <span className="avatar-stack">
      {chat.participants
        .filter((p) => p.id !== viewerId)
        .slice(0, 2)
        .map((p) => (
          <UserAvatar key={p.id} person={p} />
        ))}
    </span>
  );
}
export function MessagesPage() {
  const [query, setQuery] = useState(""),
    [picker, setPicker] = useState(false),
    list = useConversations(useDebounced(query)),
    viewer = useViewer()!;
  return (
    <div>
      <Heading
        back
        actions={
          <IconButton label="New message" onClick={() => setPicker(true)}>
            <SquarePen />
          </IconButton>
        }
      >
        Messages
      </Heading>
      <label className="search-field">
        <Search size={19} />
        <Input
          aria-label="Search conversations"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <QueryState pending={list.isPending} error={list.error} retry={() => void list.refetch()}>
        <div className="conversation-list">
          {list.data?.pages
            .flatMap((p) => p.items)
            .map((chat) => (
              <Link
                className="conversation-row"
                to="/messages/$conversationId"
                params={{ conversationId: chat.id }}
                key={chat.id}
              >
                <ChatAvatars chat={chat} viewerId={viewer.id} />
                <span className="person-label">
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
                {chat.unreadCount > 0 && <i className="unread-dot" />}
              </Link>
            ))}
        </div>
        {list.data?.pages[0]?.items.length === 0 && (
          <p className="empty-state">No conversations yet.</p>
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
type Draft = { body: string; attachment?: SavedLink; clientId: string };
export function ConversationPage({ id, attach }: { id: string; attach?: string }) {
  const { detail, list } = useConversation(id),
    actions = useMessageActions(),
    api = useAPI(),
    viewer = useViewer()!,
    navigate = useNavigate();
  const [draft, setDraft] = useDraft<Draft>("message:" + id, {
      body: "",
      clientId: crypto.randomUUID(),
    }),
    [failure, setFailure] = useState(false);
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
    setDraft({ ...draft, attachment: link, clientId: crypto.randomUUID() });
    input.current?.focus();
  });
  useEffect(() => {
    if (attached.data && attach) {
      queueAttachment(attached.data);
      void navigate({ to: ".", search: (old) => ({ ...old, attach: undefined }), replace: true });
    }
  }, [attached.data, attach, navigate]);
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
    if (!draft.body.trim() && !draft.attachment) return;
    setFailure(false);
    try {
      await actions.send.mutateAsync({
        conversationId: id,
        body: draft.body,
        linkId: draft.attachment?.id,
        clientId: draft.clientId,
      });
      setDraft({ body: "", clientId: crypto.randomUUID() });
      nearBottom.current = true;
      input.current?.focus();
    } catch {
      setFailure(true);
    }
  }
  return (
    <QueryState pending={detail.isPending} error={detail.error} retry={() => void detail.refetch()}>
      {detail.data && (
        <div className="chat-page">
          <header className="chat-heading">
            <Back fallback="/messages" />
            <ChatAvatars chat={detail.data} viewerId={viewer.id} />
            <div className="person-label">
              <strong>{conversationName(detail.data, viewer.id)}</strong>
              <small>
                {detail.data.participants
                  .filter((p) => p.id !== viewer.id)
                  .map((p, i) => (
                    <span key={p.id}>
                      {i > 0 ? ", " : ""}
                      <Link to="/people/$userId" params={{ userId: p.id }}>
                        @{p.username ?? p.name}
                      </Link>
                    </span>
                  ))}
              </small>
            </div>
          </header>
          <div
            className="chat-scroller"
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
              error={list.error}
              retry={() => void list.refetch()}
            >
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={
                    "message " + (message.senderId === viewer.id ? "outgoing" : "incoming")
                  }
                >
                  {detail.data!.participants.length > 2 && message.senderId !== viewer.id && (
                    <small>
                      {detail.data!.participants.find((p) => p.id === message.senderId)?.name ??
                        "Former participant"}
                    </small>
                  )}
                  <div className="message-bubble">
                    <SharedPost message={message} />
                    {message.body && <p>{message.body}</p>}
                  </div>
                  <small>{timeAgo(message.createdAt)}</small>
                </div>
              ))}
            </QueryState>
            <div ref={end} />
          </div>
          <div className="chat-composer-area">
            {attached.error && <p role="alert">This attachment is unavailable.</p>}
            {draft.attachment && (
              <div className="draft-attachment">
                <Link2 />
                <div className="person-label">
                  <strong>{draft.attachment.title}</strong>
                  <small>{domain(draft.attachment.url)}</small>
                </div>
                <IconButton
                  label="Remove attachment"
                  disabled={actions.send.isPending}
                  onClick={() =>
                    setDraft({ ...draft, attachment: undefined, clientId: crypto.randomUUID() })
                  }
                >
                  <X />
                </IconButton>
              </div>
            )}
            {failure && (
              <p className="field-error" role="alert">
                Message wasn’t sent. Your draft is safe. Try sending again.
              </p>
            )}
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <Input
                ref={input}
                disabled={actions.send.isPending}
                aria-label="Message"
                placeholder="Message"
                maxLength={10000}
                value={draft.body}
                onChange={(e) =>
                  setDraft({ ...draft, body: e.target.value, clientId: crypto.randomUUID() })
                }
              />
              <Button
                type="submit"
                size="icon"
                aria-label="Send message"
                disabled={actions.send.isPending || (!draft.body.trim() && !draft.attachment)}
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
        className="shared-post"
        onClick={() =>
          void navigate({ to: ".", search: (old) => ({ ...old, post: message.attachment!.id }) })
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
        className="shared-post restricted"
        to="/people/$userId"
        params={{ userId: message.restrictedAuthor.id }}
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
    <div className="shared-post unavailable">
      <LockKeyhole />
      <span>Post unavailable</span>
    </div>
  ) : null;
}
