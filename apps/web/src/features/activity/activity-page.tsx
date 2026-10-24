import { canPrefetch } from "@/data/client";
import { placeholderProfile } from "@/data/placeholders";
import { useEffect } from "react";
import { ProfileLink } from "@/components/app/profile-link";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@index/ui/components/button";
import { ChevronRight } from "lucide-react";
import { Heading } from "@/components/app/navigation";
import { QueryState, More } from "@/components/app/query-state";
import { UserAvatar } from "@/components/app/user-avatar";
import { useActivity } from "./hooks/use-activity";
import { useProfileActions } from "@/features/profiles/hooks/use-profiles";
import { timeAgo } from "@/lib/weeks";
import { useQueryClient } from "@tanstack/react-query";
import { useAPI } from "@/hooks/use-api";
import { modalNavigation } from "@/lib/search";
import { activityOptions } from "./queries";
import type { Activity } from "@/lib/types";
import { preparePostReference } from "@/features/links/queries";
type Filter = "all" | "comment" | "request" | "mention" | "follow";
// Covers its row through ::after; the chevron shows where the row leads. Empty for a pending request,
// whose buttons take that place.
const rowTargetClassName =
  "activity-target flex-none flex size-8 items-center justify-center rounded-full text-foreground empty:size-0 hover:bg-muted [&_svg]:size-4 after:absolute after:inset-0 after:content-['']";
/** What happened, after the name of who did it. */
function activitySummary(item: Pick<Activity, "type">) {
  switch (item.type) {
    case "comment":
      return "commented on your post";
    case "mention":
      return "mentioned you in a comment";
    case "follow":
      return "started following you";
    case "accepted":
      return "accepted your follow request";
    case "request":
      return "requested to follow you";
  }
}
/** Below it: the comment itself, or what became of a request. */
function activityDetail(item: Pick<Activity, "type" | "body" | "requestStatus">) {
  if (item.type === "comment" || item.type === "mention") return item.body;
  if (item.type !== "request" || item.requestStatus === "pending") return null;
  return item.requestStatus === "accepted"
    ? "Follow request accepted."
    : item.requestStatus === "declined"
      ? "Follow request declined."
      : "Follow request canceled.";
}
export function ActivityPage({ filter = "all" }: { filter?: Filter }) {
  const navigate = useNavigate(),
    { list, read } = useActivity(filter === "all" ? undefined : filter),
    actions = useProfileActions(),
    cache = useQueryClient(),
    api = useAPI();
  const prefetchFilter = (value: Filter) =>
    canPrefetch() &&
    void cache.prefetchInfiniteQuery(activityOptions(api, value === "all" ? undefined : value));
  const preparePostFor = (item: { linkId: string | null; linkShortId: string | null }) => {
    if (item.linkId && item.linkShortId)
      preparePostReference(cache, api, { id: item.linkId, shortId: item.linkShortId });
  };
  const items =
    list.data?.pages.flatMap((p) => p.items) ??
    (list.isPending
      ? [0, 1, 2].map((index) => ({
          id: `placeholder-${index}`,
          actor: placeholderProfile,
          type: "follow" as const,
          readAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          body: null,
          linkId: null,
          linkShortId: null,
          requestStatus: null,
        }))
      : []);
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
          "filter-strip flex gap-2 items-center overflow-x-auto whitespace-nowrap mb-6 [&>*]:shrink-0 [&_button]:text-[12px] [&_button]:h-8.5 [&_button]:p-[0_14px]"
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
            // The whole row opens what it is about: the post with the comment, or the person.
            // Its target is stretched over the row; the profile links and request buttons sit above.
            <article
              data-placeholder={list.isPending || undefined}
              className={
                "activity-row relative flex items-center gap-3 p-[14px_0] [&>a:first-child]:relative [&>a:first-child]:z-1 [@media(width<=700px)]:gap-2.5 [@media(width<=700px)]:[&_.user-avatar]:w-8.5 [@media(width<=700px)]:[&_.user-avatar]:h-8.5"
              }
              key={a.id}
            >
              <ProfileLink person={a.actor}>
                <UserAvatar person={a.actor} />
              </ProfileLink>
              <div
                className={
                  "activity-body flex-1 min-w-0 text-[13px] leading-[18px] [&_header_a]:relative [&_header_a]:z-1 [&_header_a]:font-medium [&_small]:ml-1.5 [&_small]:text-[11px] [&_small]:text-subtle-foreground [&_p]:mt-0.5 [&_p]:text-foreground [&_p]:wrap-anywhere [@media(width<=700px)]:text-[12px]"
                }
              >
                <header>
                  <ProfileLink person={a.actor}>{a.actor.username ?? a.actor.name}</ProfileLink>{" "}
                  {activitySummary(a)}
                  <small>{timeAgo(a.createdAt)}</small>
                </header>
                {activityDetail(a) && <p>{activityDetail(a)}</p>}
              </div>
              {a.linkId ? (
                <Link
                  {...modalNavigation({ post: a.linkShortId ?? undefined })}
                  className={rowTargetClassName}
                  aria-label="Open post"
                  title="Open post"
                  onPointerEnter={() => preparePostFor(a)}
                  onFocus={() => preparePostFor(a)}
                  onPointerDown={() => preparePostFor(a)}
                >
                  <ChevronRight />
                </Link>
              ) : (
                // The name already links to the profile, so this target is for pointers only.
                <ProfileLink
                  person={a.actor}
                  className={rowTargetClassName}
                  tabIndex={-1}
                  aria-hidden
                >
                  {a.type === "request" && a.requestStatus === "pending" ? null : <ChevronRight />}
                </ProfileLink>
              )}
              {a.type === "request" && a.requestStatus === "pending" && (
                <div
                  className={
                    "request-actions relative z-1 flex gap-1.5 shrink-0 [&_button]:text-[11px] [&_button]:p-[0_11px] [&_button]:h-9 [@media(width<=700px)]:[&_button]:p-[0_9px] [@media(width<=700px)]:[&_button]:text-[10px] [@media(width<=700px)]:gap-1.25"
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
              )}
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
