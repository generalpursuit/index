import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@index/ui/components/button";
import { Input } from "@index/ui/components/input";
import { Checkbox } from "@index/ui/components/checkbox";
import { ChevronRight } from "lucide-react";
import { Modal, UserAvatar, QueryState, More } from "@/components/app/primitives";
import { useQuery } from "@tanstack/react-query";
import { useViewer, useAPI } from "@/hooks/use-api";
import { useDebounced } from "@/hooks/use-debounced";
import { useConnections } from "@/features/profiles/hooks/use-profiles";
import { useConversations, useMessageActions } from "./hooks/use-messages";
import type { SavedLink, Conversation } from "@/lib/types";

// Shared by instances in this component; markers remain available to scroll hooks/tests.
const personLabelClassName =
  "person-label [&_small]:text-subtle-foreground [&_small]:leading-[16px] [&_small]:text-[12px] [&_small]:overflow-hidden [&_small]:text-ellipsis [&_small]:whitespace-nowrap [&_strong]:font-medium [&_strong]:leading-[18px] [&_strong]:overflow-hidden [&_strong]:text-ellipsis flex flex-col min-w-0 gap-px [&_strong_svg]:inline [&_strong_svg]:align-middle";
const recipientRowClassName =
  "recipient-row [&>.person-label]:flex-1 [@media(hover:_hover)_and_(pointer:_fine)]:[&:hover_.recipient-select]:opacity-[1] [@media(hover:_hover)_and_(pointer:_fine)]:[&:focus-within_.recipient-select]:opacity-[1]";

export function conversationName(chat: Conversation, viewerId: string) {
  return (
    chat.participants
      .filter((p) => p.id !== viewerId)
      .map((p) => (chat.participants.length > 2 ? p.name.split(" ")[0] : p.name))
      .join(", ") || "Conversation"
  );
}
export function RecipientPicker({ link, onClose }: { link?: SavedLink; onClose: () => void }) {
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
  const open = (id: string) => {
    onClose();
    void navigate({
      to: "/messages/$conversationId",
      params: { conversationId: id },
      search: { attach: link?.shortId },
    });
  };
  return (
    <Modal
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={link ? "Send link" : "New message"}
    >
      {author.data?.profileVisibility === "private" && (
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
          "recipient-list max-h-[35dvh] overflow-auto [&_.recipient-row]:flex [&_.recipient-row]:h-auto [&_.recipient-row]:justify-start [&_.recipient-row]:cursor-pointer [&_.recipient-row]:w-full [&_.recipient-row]:items-center [&_.recipient-row]:gap-3 [&_.recipient-row]:p-3 [&_.recipient-row]:rounded-[12px] [&_.recipient-row]:text-left"
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
                  onClick={() =>
                    start.mutate(
                      { recipientIds: [person.id] },
                      { onSuccess: (chat) => open(chat.shortId) },
                    )
                  }
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
            <Button
              variant="ghost"
              className={
                "person-row flex items-center justify-between gap-4 p-[13px_0] [&>.person-inline]:flex-1 [&_.person-label]:max-w-full [&>button]:shrink-0 [@media(width<=700px)]:gap-2.5 [@media(width<=700px)]:[&_.person-label_small]:max-w-45"
              }
              key={chat.id}
              onClick={() => open(chat.shortId)}
            >
              <span
                className={
                  "avatar-stack relative inline-flex w-12 h-12 flex-none items-center [&_.user-avatar]:w-11 [&_.user-avatar]:h-11 [&:has(.user-avatar:nth-child(2))_.user-avatar]:w-7.75 [&:has(.user-avatar:nth-child(2))_.user-avatar]:h-7.75 [&:has(.user-avatar:nth-child(2))_.user-avatar]:absolute [&:has(.user-avatar:nth-child(2))_.user-avatar]:left-0 [&:has(.user-avatar:nth-child(2))_.user-avatar]:top-0 [&_.user-avatar:nth-child(2)]:left-4! [&_.user-avatar:nth-child(2)]:top-4.25! [&_.user-avatar:nth-child(2)]:[outline:2px_solid_var(--background)]"
                }
              >
                {chat.participants
                  .filter((p) => p.id !== viewer.id)
                  .slice(0, 2)
                  .map((p) => (
                    <UserAvatar key={p.id} person={p} />
                  ))}
              </span>
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
      <div
        className={
          "modal-actions flex items-center justify-end gap-2 mt-1 [&_[data-slot='button']]:min-h-9.5 [&_[data-slot='button']]:p-[0_18px] [&_[data-slot='button']]:rounded-full"
        }
      >
        <Button type="button" variant="ghost" className="modal-cancel" onClick={onClose}>
          Cancel
        </Button>
        {!singleRecipient && (
          <Button
            disabled={!selected.length || start.isPending || selected.length > 19}
            onClick={() =>
              start.mutate({ recipientIds: selected }, { onSuccess: (chat) => open(chat.shortId) })
            }
          >
            {start.isPending
              ? "Opening…"
              : "Next" + (selected.length ? " (" + selected.length + ")" : "")}
          </Button>
        )}
      </div>
    </Modal>
  );
}
