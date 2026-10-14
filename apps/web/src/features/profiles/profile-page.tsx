import { canPrefetch } from "@/data/client";
import { placeholderProfile } from "@/data/placeholders";
import { LinksPlaceholder } from "@/features/links/link-row";
import { useRouterState } from "@tanstack/react-router";
import { groupPath } from "@index/api/routes";
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { FollowedBy } from "./followed-by";
import { Button } from "@index/ui/components/button";
import { LockKeyhole, Earth, Settings } from "lucide-react";
import { UserAvatar } from "@/components/app/user-avatar";
import { QueryState, More } from "@/components/app/query-state";
import { useAPI, useViewer } from "@/hooks/use-api";
import { useQueryClient } from "@tanstack/react-query";
import { connectionsOptions } from "./queries";
import { useProfile, useProfileActions } from "./hooks/use-profiles";
import { useLibraryWeeks } from "@/features/links/hooks/use-links";
import { useAllGroups } from "@/features/groups/use-groups";
import { WeekLinks } from "@/features/links/week-links";
import { CreateGroup } from "@/features/groups/create-group";
import { WeekPicker, WeekScrubber, type Week } from "@/components/app/week-scrubber";
import { monday, weekLabel, weekRange } from "@/lib/weeks";
import { Connections } from "./connections";
import { ListDock } from "./list-dock";
import type { Profile, Person } from "@/lib/types";
const count = (n: number, noun: string) => n + " " + noun + (n === 1 ? "" : "s");
export function FollowButton({
  person,
  followingStatus,
}: {
  person: Person;
  followingStatus?: Profile["followingStatus"];
}) {
  const viewer = useViewer(),
    profile = useProfile(
      person.id,
      followingStatus === undefined && !!viewer && viewer.id !== person.id,
    ),
    actions = useProfileActions();
  if (viewer?.id === person.id) return null;
  if (!viewer)
    return (
      <Link className={"pill border border-input p-[8px_12px] rounded-full"} to="/login">
        Sign in to follow
      </Link>
    );
  const status = followingStatus !== undefined ? followingStatus : profile.data?.followingStatus;
  return (
    <Button
      variant="outline"
      disabled={
        (followingStatus === undefined && profile.isPending) ||
        actions.follow.isPending ||
        actions.unfollow.isPending
      }
      onClick={() =>
        status
          ? actions.unfollow.mutate({ userId: person.id })
          : actions.follow.mutate({ userId: person.id })
      }
    >
      {/* Every label sits in the same cell, so the button keeps one width in every state. */}
      <span
        className={"size-stack grid [&>*]:[grid-area:1_/_1] follow-label [justify-items:center]"}
      >
        <span>
          {status === "accepted"
            ? "Following"
            : status === "pending"
              ? "Requested"
              : person.profileVisibility === "private"
                ? "Request"
                : "Follow"}
        </span>
        {followLabels.map((label) => (
          <span key={label} className={"size-stack-ghost [visibility:hidden]"}>
            {label}
          </span>
        ))}
      </span>
    </Button>
  );
}
const followLabels = ["Follow", "Request", "Requested", "Following"];
export function ProfilePage({ userId, group = "all" }: { userId: string; group?: string }) {
  const hinted = useRouterState({ select: (state) => state.location.state.userId });
  userId ||= hinted ?? "";
  const profile = useProfile(userId);
  return (
    <QueryState
      placeholder={<ProfileContent profile={placeholderProfile} filter={group} placeholder />}
      pending={profile.isPending}
      hasData={!!profile.data}
      error={profile.error}
      retry={() => void profile.refetch()}
    >
      {profile.data && (
        <ProfileContent
          key={userId}
          profile={profile.data}
          filter={group}
          placeholder={profile.isPlaceholderData}
        />
      )}
    </QueryState>
  );
}
function ProfileContent({
  profile,
  filter,
  placeholder = false,
}: {
  profile: Profile;
  filter: string;
  placeholder?: boolean;
}) {
  const viewer = useViewer(),
    own = viewer?.id === profile.id,
    navigate = useNavigate();
  const [connections, setConnections] = useState<"followers" | "following" | null>(null),
    [newGroup, setNewGroup] = useState(false);
  const groupReturnFocus = useRef<HTMLButtonElement>(null);
  const hidden = !profile.canViewContent;
  const cache = useQueryClient(),
    api = useAPI();
  // Both tabs, so switching between them is instant too.
  const prefetchConnections = () => {
    if (!canPrefetch()) return;
    for (const kind of ["followers", "following"] as const)
      void cache.prefetchInfiniteQuery(connectionsOptions(api, profile.id, kind));
  };
  return (
    <div className="profile-page" data-placeholder={(placeholder && !profile.id) || undefined}>
      <header
        className={
          "profile-heading flex items-center gap-5 mb-8 [@media(width<=700px)]:[&_.user-avatar.large]:w-16 [@media(width<=700px)]:[&_.user-avatar.large]:h-16 [@media(width<=700px)]:[&_.user-avatar.large_[data-slot='avatar-fallback']]:text-[20px] [&_h1]:font-serif [&_h1]:font-bold [&_h1]:[font-variation-settings:'opsz'_60] [&_h1]:tracking-[-0.015em] [&_h1]:leading-[1] [&_h1]:text-[clamp(30px,_3.4vw,_40px)]"
        }
      >
        <UserAvatar person={profile} large />
        <div className={"profile-identity flex-1 min-w-0 flex flex-col gap-2.5"}>
          <div
            className={
              "profile-name flex items-center gap-2.5 min-w-0 [&_h1]:min-w-0 [&_h1]:wrap-anywhere [&_[data-slot='button']]:flex-none [&_[data-slot='button']]:text-subtle-foreground [&_[data-slot='button']:hover]:text-foreground"
            }
          >
            <h1>{profile.name}</h1>
            <span
              className={"profile-visibility inline-flex flex-none text-subtle-foreground"}
              data-placeholder={placeholder || undefined}
              role="img"
              aria-label={
                profile.profileVisibility === "private" ? "Private profile" : "Public profile"
              }
              title={profile.profileVisibility === "private" ? "Private profile" : "Public profile"}
            >
              {profile.profileVisibility === "private" ? (
                <LockKeyhole size={16} aria-hidden="true" />
              ) : (
                <Earth size={16} aria-hidden="true" />
              )}
            </span>
          </div>
          <p
            className={
              "profile-meta flex flex-wrap items-center gap-[4px_14px] text-[13px] text-subtle-foreground [&_span]:inline-flex [&_span]:items-center [&_span]:gap-1 [&_button:hover]:text-foreground"
            }
          >
            {profile.username && <span>{profile.username}</span>}
            {profile.linkCount !== null && <span>{count(profile.linkCount, "link")}</span>}
            {own && (
              <>
                <button
                  type="button"
                  onPointerEnter={prefetchConnections}
                  onFocus={prefetchConnections}
                  onClick={() => setConnections("followers")}
                >
                  {count(profile.followerCount ?? 0, "follower")}
                </button>
                <button
                  type="button"
                  onPointerEnter={prefetchConnections}
                  onFocus={prefetchConnections}
                  onClick={() => setConnections("following")}
                >
                  {profile.followingCount ?? 0} following
                </button>
              </>
            )}
          </p>
        </div>
        <div
          className={
            "heading-actions flex gap-1 items-center ml-auto [@media(width<=700px)]:gap-0.5"
          }
        >
          {own ? (
            // Phones only: larger screens have Settings at the foot of the navigation rail.
            <Link
              to="/settings"
              className={
                "icon-link [@media(width>=701px)]:[&.profile-settings]:hidden relative flex items-center justify-center w-11 h-11 text-foreground rounded-full [&_svg]:w-6.25 [&_svg]:h-6.25 [&_svg]:stroke-[1.7] profile-settings"
              }
              aria-label="Settings"
              title="Settings"
            >
              <Settings />
            </Link>
          ) : (
            !hidden && <FollowButton person={profile} />
          )}
        </div>
      </header>
      {!own && profile.followedBy.total > 0 && (
        <p
          className={
            "muted text-subtle-foreground social-context m-[-16px_0_28px] text-[13px] [&_a]:text-foreground"
          }
        >
          <FollowedBy context={profile.followedBy} linked />
        </p>
      )}
      {placeholder ? (
        <ProfileLinks key={filter} userId={profile.id} own={own} filter={filter} />
      ) : hidden ? (
        <div
          className={
            "private-profile text-center border-t border-t-border p-[65px_24px] flex flex-col items-center gap-4 [&_h2]:text-[18px] [&_p]:max-w-75 [&_button]:mt-2 [&_button]:min-w-40"
          }
        >
          <LockKeyhole size={32} />
          <h2>Private profile</h2>
          <p className={"muted text-subtle-foreground"}>
            Only {profile.name}’s followers can view their posts.
          </p>
          <FollowButton person={profile} />
        </div>
      ) : (
        <>
          <ProfileLinks key={filter} userId={profile.id} own={own} filter={filter} />
          <ListDock
            userId={profile.id}
            username={profile.username!}
            own={own}
            onNewGroup={(trigger) => {
              groupReturnFocus.current = trigger;
              setNewGroup(true);
            }}
          />
        </>
      )}
      {connections && <Connections initial={connections} onClose={() => setConnections(null)} />}
      {newGroup && (
        <CreateGroup
          returnFocus={groupReturnFocus}
          onClose={() => setNewGroup(false)}
          onCreated={(group) => {
            setNewGroup(false);
            void navigate({
              to: groupPath(profile.username!, group.slug),
              search: (old) => ({ ...old, group: undefined }),
              state: { userId: profile.id, groupId: group.id },
            });
          }}
        />
      )}
    </div>
  );
}
/**
 * One person's links as one continuous list of weeks. Each week's heading sticks while you
 * read it, and the scrubber (or the week title) jumps to any week. Weeks with nothing in the
 * chosen list are skipped.
 */
function ProfileLinks({ userId, own, filter }: { userId: string; own: boolean; filter: string }) {
  const groups = useAllGroups(userId),
    allGroups = groups.data?.pages.flatMap((p) => p.items) ?? [],
    selected = allGroups.find((g) => g.id === filter);
  // A chosen list is known once groups load. Starred has no group until something is starred,
  // and a deleted group has none either; both simply show as empty.
  const ready =
      filter === "all" ? !!groups.data && !groups.hasNextPage : !!selected || groups.complete,
    missing = groups.complete && filter !== "all" && !selected;
  const list = useLibraryWeeks(userId, selected?.id, filter === "all" || !!selected),
    canAdd = own && (filter === "all" || selected?.kind === "custom");
  // The scrubber shows every week, and the list is small (one entry per week): load it all.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  useEffect(() => {
    if (hasNextPage && !list.isFetching && !list.isError) void fetchNextPage();
  }, [hasNextPage, list.isFetching, list.isError, fetchNextPage]);
  const loaded =
    filter === "all" || selected ? (list.data?.pages.flatMap((p) => p.items) ?? []) : [];
  const weeks: Week[] = missing
    ? []
    : canAdd && loaded[0]?.weekStart !== monday()
      ? [{ weekStart: monday(), count: 0 }, ...loaded]
      : loaded;
  const lockedGroups =
    own && filter === "all"
      ? new Set(allGroups.filter((g) => g.visibility === "private").map((g) => g.id))
      : undefined;
  const [picking, setPicking] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const onScreen = useVisibleWeeks(listRef, weeks);
  const jump = (week: string) =>
    document.querySelector(`.profile-week[data-week="${week}"]`)?.scrollIntoView({
      block: "start",
      behavior: "instant",
    });
  return (
    <div
      ref={listRef}
      className={"profile-links [--row:48px] relative [@media(width<=700px)]:[--row:46px]"}
    >
      <QueryState
        placeholder={<LinksPlaceholder />}
        pending={!groups.error && (!ready || (!missing && list.isPending))}
        hasData={ready && !!list.data}
        error={groups.error ?? list.error}
        retry={() =>
          void (groups.isFetchNextPageError
            ? groups.fetchNextPage()
            : groups.error
              ? groups.refetch()
              : list.refetch())
        }
      >
        {weeks.length ? (
          <>
            {weeks.map((w) => (
              <ProfileWeek
                key={w.weekStart}
                userId={userId}
                week={w}
                groupId={selected?.id}
                add={canAdd && w.weekStart === monday()}
                showOwners={selected?.kind === "starred"}
                lockedGroups={lockedGroups}
                onPick={() => setPicking(true)}
              />
            ))}
            <WeekScrubber weeks={weeks} active={onScreen} onJump={jump} />
          </>
        ) : (
          <div
            className={
              "empty-box flex flex-col justify-center items-center gap-3 min-h-40 p-6 text-subtle-foreground text-center [&_a]:text-foreground [&_a:hover]:underline [&_a:hover]:underline-offset-[4px]"
            }
          >
            <p>
              {filter === "all"
                ? "No links yet"
                : selected?.kind === "favorites"
                  ? "No favorites yet"
                  : selected?.kind === "starred" || filter === "starred"
                    ? "No starred links yet"
                    : "Nothing in this group yet"}
            </p>
          </div>
        )}
      </QueryState>
      {list.isFetchNextPageError && (
        <More hasNext isFetching={isFetchingNextPage} fetch={fetchNextPage} />
      )}
      <WeekPicker open={picking} onOpenChange={setPicking} weeks={weeks} onPick={jump} />
    </div>
  );
}
/**
 * A week of the list. Its links load once it comes near the screen; until then it holds
 * their space, so jumping to any week lands exactly.
 */
function ProfileWeek({
  userId,
  week,
  groupId,
  add,
  showOwners,
  lockedGroups,
  onPick,
}: {
  userId: string;
  week: Week;
  groupId?: string;
  add: boolean;
  showOwners: boolean;
  lockedGroups?: ReadonlySet<string>;
  onPick: () => void;
}) {
  const section = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = section.current;
    if (!element || near) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setNear(true);
      },
      { root: document.getElementById("app-scroll"), rootMargin: "800px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);
  return (
    <section
      ref={section}
      className={
        "profile-week [&+.profile-week]:mt-5 [&_h2_button]:flex [&_h2_button]:[align-items:baseline] [&_h2_button]:gap-3 [&_h2_button]:text-[24px] [&_h2_button]:whitespace-nowrap [&_h2_span]:font-mono [&_h2_span]:text-[12px] [&_h2_span]:font-normal [&_h2_span]:[font-variation-settings:normal] [&_h2_span]:tracking-[0.06em] [&_h2_span]:uppercase [&_h2_span]:text-subtle-foreground [&_h2]:font-serif [&_h2]:font-bold [&_h2]:[font-variation-settings:'opsz'_60] [&_h2]:tracking-[-0.015em] [&_h2]:leading-[1]"
      }
      data-week={week.weekStart}
      aria-label={weekLabel(week.weekStart)}
    >
      <div
        className={
          "profile-week-heading sticky top-0 z-2 flex items-center justify-between h-13 bg-background"
        }
      >
        <h2>
          <button
            type="button"
            onClick={onPick}
            aria-label={"Jump to a week, now " + weekLabel(week.weekStart)}
          >
            {weekLabel(week.weekStart)}
            <span>{weekRange(week.weekStart)}</span>
          </button>
        </h2>
      </div>
      {near ? (
        <WeekLinks
          userId={userId}
          week={week.weekStart}
          groupId={groupId}
          add={add}
          showOwners={showOwners}
          lockedGroups={lockedGroups}
          placeholder={<WeekPlaceholder rows={week.count} />}
        />
      ) : (
        <WeekPlaceholder rows={week.count + (add ? 1 : 0)} />
      )}
    </section>
  );
}
function WeekPlaceholder({ rows }: { rows: number }) {
  return (
    <div
      className={"profile-week-placeholder h-[calc(var(--rows)_*_var(--row))]"}
      style={{ "--rows": rows } as CSSProperties}
    >
      <LinksPlaceholder rows={rows} />
    </div>
  );
}
/** The weeks with some of their section on screen, as you scroll. */
function useVisibleWeeks(list: RefObject<HTMLElement | null>, weeks: Week[]) {
  const [visible, setVisible] = useState<string[]>([]);
  // `weeks` is a new array on every render; watch the sections again only when they change.
  const key = weeks.map((w) => w.weekStart).join();
  useEffect(() => {
    const root = document.getElementById("app-scroll"),
      sections = list.current?.querySelectorAll<HTMLElement>(".profile-week");
    if (!root || !sections?.length) return;
    const shown = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const week = (entry.target as HTMLElement).dataset.week!;
          if (entry.isIntersecting) shown.add(week);
          else shown.delete(week);
        }
        setVisible([...shown]);
      },
      // A sliver at the top or bottom edge doesn't count.
      { root, rootMargin: "-8px 0px" },
    );
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, [list, key]);
  return visible;
}
