import { useEffect } from "react";
import { ProfileLink } from "@/components/app/profile-link";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@index/ui/components/button";
import { ChevronRight } from "lucide-react";
import { Heading } from "@/components/app/navigation";
import { QueryState, More } from "@/components/app/query-state";
import { UserAvatar } from "@/components/app/user-avatar";
import { IconButton } from "@index/ui/components/icon-button";
import { useActivity } from "./hooks/use-activity";
import { useProfileActions } from "@/features/profiles/hooks/use-profiles";
import { timeAgo } from "@/lib/weeks";
import { useQueryClient } from "@tanstack/react-query";
import { useAPI } from "@/hooks/use-api";
import { activityOptions } from "./queries";
import { preparePostReference } from "@/features/links/queries";
type Filter = "all" | "comment" | "request" | "mention" | "follow";
export function ActivityPage({ filter = "all" }: { filter?: Filter }) {
  const navigate = useNavigate(),
    { list, read } = useActivity(filter === "all" ? undefined : filter),
    actions = useProfileActions(),
    cache = useQueryClient(),
    api = useAPI();
  const prefetchFilter = (value: Filter) =>
    void cache.prefetchInfiniteQuery(activityOptions(api, value === "all" ? undefined : value));
  const preparePostFor = (item: { linkId: string | null; linkShortId: string | null }) => {
    if (item.linkId && item.linkShortId)
      preparePostReference(cache, api, { id: item.linkId, shortId: item.linkShortId });
  };
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
    <div
      className={
        "activity-page [&>.page-heading_h1]:font-serif [&>.page-heading_h1]:font-bold [&>.page-heading_h1]:[font-variation-settings:'opsz'_60] [&>.page-heading_h1]:tracking-[-0.015em] [&>.page-heading_h1]:leading-[1] [&>.page-heading_h1]:text-[clamp(44px,_5vw,_62px)] [@media(width<=700px)_and_(height<=740px)]:[&>.page-heading_h1]:text-[36px]"
      }
    >
      <Heading>Activity</Heading>
      <div
        className={
          "filter-strip flex gap-2 items-center overflow-x-auto whitespace-nowrap [scrollbar-width:none] mb-6 [&>*]:shrink-0 [&_button]:text-[12px] [&_button]:h-8.5 [&_button]:p-[0_14px]"
        }
      >
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
            onPointerEnter={() => prefetchFilter(value)}
            onFocus={() => prefetchFilter(value)}
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
            <article
              className={
                "activity-row [&_small]:text-subtle-foreground flex items-center gap-3 p-[14px_0] [@media(width<=700px)]:gap-2.5 [@media(width<=700px)]:p-[14px_0] [@media(width<=700px)]:[&_.user-avatar]:w-8.5 [@media(width<=700px)]:[&_.user-avatar]:h-8.5"
              }
              key={a.id}
            >
              <ProfileLink person={a.actor}>
                <UserAvatar person={a.actor} />
              </ProfileLink>
              <div
                className={
                  "activity-body flex-1 min-w-0 text-[13px] [&_header]:flex [&_header]:items-center [&_header]:gap-2 [&_header]:text-[13px] [&_small]:text-[11px] [&_p]:mt-0.5 [&_p]:text-foreground [&_p]:wrap-anywhere [@media(width<=700px)]:text-[12px] [@media(width<=700px)]:[&_header]:text-[12px] [@media(width<=700px)]:[&_header]:gap-1.5"
                }
              >
                <header>
                  <ProfileLink person={a.actor}>{a.actor.username ?? a.actor.name}</ProfileLink>
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
                <div
                  className={
                    "request-actions flex gap-1.5 shrink-0 [&_button]:text-[11px] [&_button]:p-[0_11px] [&_button]:h-9 [@media(width<=700px)]:[&_button]:p-[0_9px] [@media(width<=700px)]:[&_button]:text-[10px] [@media(width<=700px)]:gap-1.25"
                  }
                >
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
                  onPointerEnter={() => preparePostFor(a)}
                  onFocus={() => preparePostFor(a)}
                  onClick={() => {
                    preparePostFor(a);
                    void navigate({
                      to: ".",
                      search: (old) => ({ ...old, post: a.linkShortId ?? undefined }),
                    });
                  }}
                >
                  <ChevronRight />
                </IconButton>
              ) : null}
            </article>
          ))}
        </div>
        {!items.length && (
          <p
            className={
              "empty-state [&[role='alert']>p]:select-text text-muted-foreground p-[32px_12px] text-center [&_p]:mb-3.5 [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-[4px]"
            }
          >
            You’re all caught up.
          </p>
        )}
        <More
          hasNext={list.hasNextPage}
          isFetching={list.isFetchingNextPage}
          fetch={list.fetchNextPage}
        />
      </QueryState>
    </div>
  );
}
