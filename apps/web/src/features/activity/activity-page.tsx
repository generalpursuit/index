import { useEffect } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@index/ui/components/button";
import { ChevronRight } from "lucide-react";
import { Heading, QueryState, UserAvatar, More, IconButton } from "@/components/app/primitives";
import { useActivity } from "./hooks/use-activity";
import { useProfileActions } from "@/features/profiles/hooks/use-profiles";
import { timeAgo } from "@/lib/weeks";
type Filter = "all" | "comment" | "request" | "mention" | "follow";
export function ActivityPage({ filter = "all" }: { filter?: Filter }) {
  const navigate = useNavigate(),
    { list, read } = useActivity(filter === "all" ? undefined : filter),
    actions = useProfileActions();
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = items
    .filter((i) => !i.readAt)
    .map((i) => i.id)
    .slice(0, 100)
    .join(",");
  const markRead = read.mutate;
  useEffect(() => {
    if (!unread) return;
    const mark = () => {
      if (!document.hidden) markRead({ ids: unread.split(",") });
    };
    const timer = setTimeout(mark, 800);
    document.addEventListener("visibilitychange", mark);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", mark);
    };
  }, [unread, markRead]);
  return (
    <div className="activity-page">
      <Heading>Activity</Heading>
      <div className="filter-strip">
        {(
          [
            ["all", "All"],
            ["comment", "Comments"],
            ["request", "Requests"],
            ["mention", "Mentions"],
            ["follow", "Follows"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            aria-pressed={filter === value}
            variant={filter === value ? "default" : "secondary"}
            onClick={() =>
              void navigate({ to: "/activity", search: { filter: value }, replace: true })
            }
          >
            {label}
          </Button>
        ))}
      </div>
      <QueryState
        pending={list.isPending}
        hasData={!!list.data}
        error={list.error}
        retry={() => void list.refetch()}
      >
        <div className="activity-list">
          {items.map((a) => (
            <article className="activity-row" key={a.id}>
              <Link to="/people/$userId" params={{ userId: a.actor.id }}>
                <UserAvatar person={a.actor} />
              </Link>
              <div className="activity-body">
                <header>
                  <Link to="/people/$userId" params={{ userId: a.actor.id }}>
                    {a.actor.username ?? a.actor.name}
                  </Link>
                  <small>{timeAgo(a.createdAt)}</small>
                </header>
                <p>
                  {a.type === "mention"
                    ? `mentioned you: ${a.body ?? ""}`
                    : a.type === "comment"
                      ? a.body
                      : a.type === "follow"
                        ? "started following you."
                        : a.type === "accepted"
                          ? "accepted your follow request."
                          : a.requestStatus === "pending"
                            ? "requested to follow you."
                            : a.requestStatus === "accepted"
                              ? "Follow request accepted."
                              : a.requestStatus === "declined"
                                ? "Follow request declined."
                                : "Follow request canceled."}
                </p>
              </div>
              {a.type === "request" && a.requestStatus === "pending" ? (
                <div className="request-actions">
                  <Button
                    disabled={actions.accept.isPending || actions.reject.isPending}
                    onClick={() => actions.accept.mutate({ userId: a.actor.id })}
                  >
                    Accept
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={actions.accept.isPending || actions.reject.isPending}
                    onClick={() => actions.reject.mutate({ userId: a.actor.id })}
                  >
                    Decline
                  </Button>
                </div>
              ) : a.linkId ? (
                <IconButton
                  label="Open post"
                  onClick={() =>
                    void navigate({
                      to: ".",
                      search: (old) => ({ ...old, post: a.linkId ?? undefined }),
                    })
                  }
                >
                  <ChevronRight />
                </IconButton>
              ) : null}
            </article>
          ))}
        </div>
        {!items.length && <p className="empty-state">You’re all caught up.</p>}
        <More
          hasNext={list.hasNextPage}
          isFetching={list.isFetchingNextPage}
          fetch={list.fetchNextPage}
        />
      </QueryState>
    </div>
  );
}
