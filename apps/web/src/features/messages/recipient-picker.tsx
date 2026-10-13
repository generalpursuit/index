import { ChatAvatars, conversationName } from "./conversation-presentation";
import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@index/ui/components/button";
import { Input } from "@index/ui/components/input";
import { Checkbox } from "@index/ui/components/checkbox";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "@index/ui/components/icon-button";
import { Modal, ModalFooter } from "@index/ui/components/modal";
import { UserAvatar } from "@/components/app/user-avatar";
import { QueryState, More } from "@/components/app/query-state";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { connectionsOptions } from "@/features/profiles/queries";
import { conversationsOptions } from "./queries";
import { useViewer, useAPI } from "@/hooks/use-api";
import { useDebounced } from "@/hooks/use-debounced";
import { useConnections } from "@/features/profiles/hooks/use-profiles";
import { useConversations, useMessageActions } from "./hooks/use-messages";
import type { SavedLink } from "@/lib/types";

// Shared by instances in this component; markers remain available to scroll hooks/tests.
const personLabelClassName =
  "person-label [&_small]:text-subtle-foreground [&_small]:leading-[16px] [&_small]:text-[12px] [&_small]:overflow-hidden [&_small]:text-ellipsis [&_small]:whitespace-nowrap [&_strong]:font-medium [&_strong]:leading-[18px] [&_strong]:overflow-hidden [&_strong]:text-ellipsis flex flex-col min-w-0 gap-px [&_strong_svg]:inline [&_strong_svg]:align-middle";
const recipientRowClassName =
  "recipient-row [&>.person-label]:flex-1 [@media(hover:_hover)_and_(pointer:_fine)]:[&:hover_.recipient-select]:opacity-[1] [@media(hover:_hover)_and_(pointer:_fine)]:[&:focus-within_.recipient-select]:opacity-[1]";

/** What the picker shows first, for whatever opens it. */
export function prefetchRecipients(
  cache: QueryClient,
  api: ReturnType<typeof useAPI>,
  viewerId: string,
) {
  void cache.prefetchInfiniteQuery(connectionsOptions(api, viewerId, "following"));
  void cache.prefetchInfiniteQuery(conversationsOptions(api));
}
/** New message, or sending a link from a page: the recipients in a modal of their own. */
export function RecipientPicker({ link, onClose }: { link?: SavedLink; onClose: () => void }) {
  return (
    <Modal
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={link ? "Send link" : "New message"}
      fixedHeight
    >
      <Recipients
        link={link}
        onOpen={onClose}
        footer={(next) => <ModalFooter onCancel={onClose}>{next}</ModalFooter>}
      />
    </Modal>
  );
}
/** Sending a link from its post's dialog: the recipients take the post's place there. */
export function SendLink({ link, onBack }: { link: SavedLink; onBack: () => void }) {
  return (
    // Keeps its height while the list loads or filters, as the picker's own modal does.
    <div className={"send-link flex h-146 min-h-0 flex-col gap-5"}>
      {/* Clear of the dialog's close button, which shares this row. */}
      <div className={"flex min-h-8 items-center gap-1 pr-10 -ml-2"}>
        <IconButton label="Back" onClick={onBack}>
          <ChevronLeft />
        </IconButton>
        <h2 className="dialog-title">Send link</h2>
      </div>
      <Recipients
        link={link}
        footer={(next) => next && <div className={"modal-actions flex justify-end"}>{next}</div>}
      />
    </div>
  );
}
/**
 * Search, the people you follow and your group chats. Choosing opens the chat, with `link`
 * attached; `footer` places the Next action for picking several people.
 */
function Recipients({
  link,
  onOpen,
  footer,
}: {
  link?: SavedLink;
  onOpen?: () => void;
  footer: (next: ReactNode) => ReactNode;
}) {
  const viewer = useViewer()!,
    navigate = useNavigate(),
    api = useAPI();
  const author = useQuery(
    api.profiles.get.queryOptions({
      input: { userId: link?.ownerId ?? viewer.id },
      enabled: !!link,
    }),
  );
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState<string[]>([]);
  const people = useConnections(viewer.id, "following", useDebounced(search));
  const conversations = useConversations(useDebounced(search)),
    { start } = useMessageActions();
  const recipients = people.data?.pages.flatMap((page) => page.items) ?? [];
  const singleRecipient = recipients.length === 1 && !people.hasNextPage && !selected.length;
  const open = (chat: { id: string; shortId: string }) => {
    onOpen?.();
    void navigate({
      to: "/messages/$conversationId",
      params: { conversationId: chat.shortId },
      search: { attach: link?.shortId },
      state: { conversationId: chat.id },
    });
  };
  return (
    <>
      {link && author.data?.profileVisibility === "private" && (
        <p className={"muted text-subtle-foreground"}>
          Only approved followers can view this post. Other recipients will see a link to the
          author’s profile.
        </p>
      )}
      <Input
        aria-label="Search recipients"
        placeholder="Search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div
        className={
          "recipient-list min-h-0 flex-1 overflow-y-auto overscroll-contain [&_.recipient-row]:flex [&_.recipient-row]:h-auto [&_.recipient-row]:justify-start [&_.recipient-row]:cursor-pointer [&_.recipient-row]:w-full [&_.recipient-row]:items-center [&_.recipient-row]:gap-3 [&_.recipient-row]:p-3 [&_.recipient-row]:rounded-[12px] [&_.recipient-row]:text-left"
        }
      >
        <QueryState
          pending={people.isPending}
          hasData={!!people.data}
          error={people.error}
          retry={() => void people.refetch()}
        >
          {recipients.map((person) => {
            const identity = (
              <>
                <UserAvatar person={person} />
                <span className={personLabelClassName}>
                  <strong id={"recipient-" + person.id}>{person.name}</strong>
                  <small>@{person.username ?? person.name}</small>
                </span>
              </>
            );
            if (singleRecipient)
              return (
                <Button
                  variant="ghost"
                  className={recipientRowClassName}
                  key={person.id}
                  disabled={start.isPending}
                  onClick={() => start.mutate({ recipientIds: [person.id] }, { onSuccess: open })}
                >
                  {identity}
                </Button>
              );
            return (
              <label className={recipientRowClassName} key={person.id}>
                {identity}
                <Checkbox
                  className={
                    "recipient-select rounded-[50%] [@media(hover:_hover)_and_(pointer:_fine)]:opacity-[0] [@media(hover:_hover)_and_(pointer:_fine)]:[&[data-checked]]:opacity-[1]"
                  }
                  aria-labelledby={"recipient-" + person.id}
                  disabled={
                    start.isPending || (!selected.includes(person.id) && selected.length >= 19)
                  }
                  checked={selected.includes(person.id)}
                  onCheckedChange={(checked) =>
                    setSelected((old) =>
                      checked ? [...old, person.id] : old.filter((id) => id !== person.id),
                    )
                  }
                />
              </label>
            );
          })}
          {people.data?.pages[0]?.items.length === 0 && (
            <p
              className={
                "empty-state [&[role='alert']>p]:select-text text-muted-foreground p-[32px_12px] text-center [&_p]:mb-3.5 [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-[4px]"
              }
            >
              Follow people to start a conversation.
            </p>
          )}
          <More
            hasNext={people.hasNextPage}
            isFetching={people.isFetchingNextPage}
            fetch={people.fetchNextPage}
          />
        </QueryState>
        {conversations.data?.pages
          .flatMap((p) => p.items)
          .filter((c) => c.participants.length > 2)
          .map((chat) => (
            // A row like the people above it, opening the chat from its far end.
            <Button
              variant="ghost"
              className={recipientRowClassName}
              key={chat.id}
              onClick={() => open(chat)}
            >
              <ChatAvatars chat={chat} viewerId={viewer.id} />
              <span className={personLabelClassName}>{conversationName(chat, viewer.id)}</span>
              <ChevronRight />
            </Button>
          ))}
        <More
          hasNext={conversations.hasNextPage}
          isFetching={conversations.isFetchingNextPage}
          fetch={conversations.fetchNextPage}
        />
      </div>
      {footer(
        !singleRecipient && (
          <Button
            disabled={!selected.length || start.isPending || selected.length > 19}
            onClick={() => start.mutate({ recipientIds: selected }, { onSuccess: open })}
          >
            {start.isPending
              ? "Opening…"
              : "Next" + (selected.length ? " (" + selected.length + ")" : "")}
          </Button>
        ),
      )}
    </>
  );
}
