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
  const open = (id: string) => {
    onClose();
    void navigate({
      to: "/messages/$conversationId",
      params: { conversationId: id },
      search: { attach: link?.id },
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
        <p className="muted">
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
      <div className="recipient-list">
        <QueryState
          pending={people.isPending}
          error={people.error}
          retry={() => void people.refetch()}
        >
          {people.data?.pages
            .flatMap((p) => p.items)
            .map((person) => (
              <label className="person-row recipient" key={person.id}>
                <UserAvatar person={person} />
                <span className="person-label">
                  <strong id={"recipient-" + person.id}>{person.name}</strong>
                  <small>@{person.username ?? person.name}</small>
                </span>
                <Checkbox
                  aria-labelledby={"recipient-" + person.id}
                  disabled={!selected.includes(person.id) && selected.length >= 19}
                  checked={selected.includes(person.id)}
                  onCheckedChange={(checked) =>
                    setSelected((old) =>
                      checked ? [...old, person.id] : old.filter((id) => id !== person.id),
                    )
                  }
                />
              </label>
            ))}
          {people.data?.pages[0]?.items.length === 0 && (
            <p className="empty-state">Follow people to start a conversation.</p>
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
              className="person-row"
              key={chat.id}
              onClick={() => open(chat.id)}
            >
              <span className="avatar-stack">
                {chat.participants
                  .filter((p) => p.id !== viewer.id)
                  .slice(0, 2)
                  .map((p) => (
                    <UserAvatar key={p.id} person={p} />
                  ))}
              </span>
              <span className="person-label">{conversationName(chat, viewer.id)}</span>
              <ChevronRight />
            </Button>
          ))}
        <More
          hasNext={conversations.hasNextPage}
          isFetching={conversations.isFetchingNextPage}
          fetch={conversations.fetchNextPage}
        />
      </div>
      <div className="modal-actions">
        <Button type="button" variant="ghost" className="modal-cancel" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!selected.length || start.isPending || selected.length > 19}
          onClick={() =>
            start.mutate({ recipientIds: selected }, { onSuccess: (chat) => open(chat.id) })
          }
        >
          {start.isPending
            ? "Opening…"
            : "Next" + (selected.length ? " (" + selected.length + ")" : "")}
        </Button>
      </div>
    </Modal>
  );
}
