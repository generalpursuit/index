import { groupPath, profilePath } from "@index/api/routes";
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { FollowedBy } from "./followed-by";
import { Button } from "@index/ui/components/button";
import { LockKeyhole, Earth, Plus, Star, Settings, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@index/ui/components/dropdown-menu";
import { UserAvatar } from "@/components/app/user-avatar";
import { QueryState, More } from "@/components/app/query-state";
import { Modal } from "@index/ui/components/modal";
import { SettingsContent } from "@/features/settings/settings-page";
import { useViewer } from "@/hooks/use-api";
import { useProfile, useProfileActions } from "./hooks/use-profiles";
import { useLibraryWeeks } from "@/features/links/hooks/use-links";
import { useAllGroups } from "@/features/groups/use-groups";
import { WeekLinks } from "@/features/links/week-links";
import { CreateGroup } from "@/features/groups/create-group";
import { WeekPicker, WeekScrubber, type Week } from "@/components/app/week-scrubber";
import { monday, weekLabel, weekRange } from "@/lib/weeks";
import { Connections } from "./connections";
import type { Profile, Person, Group } from "@/lib/types";
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
export function ProfilePage({
  userId,
  group = "all",
  settings = false,
}: {
  userId: string;
  group?: string;
  settings?: boolean;
}) {
  const profile = useProfile(userId);
  return (
    <QueryState
      pending={profile.isPending}
      hasData={!!profile.data}
      error={profile.error}
      retry={() => void profile.refetch()}
    >
      {profile.data && (
        <ProfileContent key={userId} profile={profile.data} filter={group} settings={settings} />
      )}
    </QueryState>
  );
}
function ProfileContent({
  profile,
  filter,
  settings,
}: {
  profile: Profile;
  filter: string;
  settings: boolean;
}) {
  const viewer = useViewer(),
    own = viewer?.id === profile.id,
    navigate = useNavigate();
  const [connections, setConnections] = useState<"followers" | "following" | null>(null),
    [newGroup, setNewGroup] = useState(false);
  const groupReturnFocus = useRef<HTMLButtonElement>(null);
  const hidden = !profile.canViewContent;
  return (
    <div className="profile-page">
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
                <button type="button" onClick={() => setConnections("followers")}>
                  {count(profile.followerCount ?? 0, "follower")}
                </button>
                <button type="button" onClick={() => setConnections("following")}>
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
              to="."
              search={(old) => ({ ...old, settings: true })}
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
      {hidden ? (
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
        <ProfileLinks
          key={filter}
          userId={profile.id}
          username={profile.username!}
          own={own}
          filter={filter}
          onNewGroup={(trigger) => {
            groupReturnFocus.current = trigger ?? null;
            setNewGroup(true);
          }}
        />
      )}
      {connections && <Connections initial={connections} onClose={() => setConnections(null)} />}
      {own && (
        <Modal
          open={settings}
          title="Settings"
          className="settings-sheet"
          onOpenChange={(open) => {
            if (!open)
              void navigate({
                to: ".",
                search: (old) => ({ ...old, settings: undefined }),
                replace: true,
                resetScroll: false,
              });
          }}
        >
          <SettingsContent userId={profile.id} />
        </Modal>
      )}
      {newGroup && (
        <CreateGroup
          returnFocus={groupReturnFocus}
          onClose={() => setNewGroup(false)}
          onCreated={(group) => {
            setNewGroup(false);
            void navigate({
              to: groupPath(profile.username!, group.slug),
              search: (old) => ({ ...old, group: undefined }),
            });
          }}
        />
      )}
    </div>
  );
}
/**
 * One person's links as one continuous list of weeks. Each week's heading sticks while you
 * read it, the list filter rides at the end of that sticky row, and the scrubber (or the week
 * title) jumps to any week. Weeks with nothing in the chosen list are skipped.
 */
function ProfileLinks({
  userId,
  username,
  own,
  filter,
  onNewGroup,
}: {
  userId: string;
  own: boolean;
  filter: string;
  onNewGroup: (trigger?: HTMLButtonElement | null) => void;
  username: string;
}) {
  const groups = useAllGroups(userId),
    allGroups = groups.data?.pages.flatMap((p) => p.items) ?? [],
    selected = allGroups.find((g) => g.id === filter),
    starredGroup = allGroups.find((g) => g.kind === "starred");
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
  const endSpace = useEndSpace(listRef, weeks.length);
  const reading = useReadingWeek(weeks);
  const navigate = useNavigate();
  const select = (group?: string) =>
    void navigate({
      to:
        !group || group === "all"
          ? profilePath(username)
          : groupPath(username, allGroups.find((g) => g.id === group)?.slug ?? group),
      search: (old) => ({ ...old, group: undefined }),
    });
  const jump = (week: string) =>
    document.querySelector(`.profile-week[data-week="${week}"]`)?.scrollIntoView({
      block: "start",
      behavior: "instant",
    });
  const filterMenu = (
    <ListFilter
      groups={allGroups}
      filter={selected?.kind === "starred" ? "starred" : filter}
      own={own}
      onSelect={(value) => select(value === "starred" ? (starredGroup?.id ?? value) : value)}
      onNewGroup={onNewGroup}
    />
  );
  return (
    <div
      ref={listRef}
      className={"profile-links [--row:48px] relative [@media(width<=700px)]:[--row:46px]"}
    >
      <QueryState
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
            {/* No height of its own: the menu sits over the end of whichever heading sticks. */}
            <div className={"profile-list-bar sticky top-0 z-3 h-0 flex justify-end [&>*]:mt-2.5"}>
              {filterMenu}
            </div>
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
            {/* Room for the last week's heading to reach the top, so every week can be jumped to. */}
            <div className="profile-end-space" style={{ height: endSpace }} aria-hidden="true" />
            <WeekScrubber
              weeks={weeks}
              active={reading}
              onJump={jump}
              anchor={listRef}
              offset={52}
            />
          </>
        ) : (
          <>
            {/* Without weeks the menu keeps its place at the end of the row. */}
            <div
              className={
                "profile-week-heading sticky top-0 z-2 flex items-center justify-between h-13 bg-background profile-menu-only justify-end"
              }
            >
              {filterMenu}
            </div>
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
          </>
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
        />
      ) : (
        <div
          className={"profile-week-placeholder h-[calc(var(--rows)_*_var(--row))]"}
          style={{ "--rows": week.count + (add ? 1 : 0) } as CSSProperties}
        />
      )}
    </section>
  );
}
/**
 * How much empty space the list needs after its last week so that week's heading can scroll
 * to the top: the scroller's height, less the last week and the page's own bottom padding.
 */
function useEndSpace(list: RefObject<HTMLElement | null>, weekCount: number) {
  const [space, setSpace] = useState(0);
  useEffect(() => {
    const scroller = document.getElementById("app-scroll"),
      last = list.current?.querySelector<HTMLElement>(".profile-week:last-of-type");
    if (!scroller || !last) return;
    const content = scroller.querySelector<HTMLElement>(".app-content");
    const measure = () => {
      const padding = content ? parseFloat(getComputedStyle(content).paddingBottom) : 0;
      setSpace(Math.max(0, scroller.clientHeight - last.offsetHeight - padding));
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(scroller);
    resize.observe(last);
    return () => resize.disconnect();
  }, [list, weekCount]);
  return space;
}
/** The week whose section reaches the top of the page, as you scroll. */
function useReadingWeek(weeks: Week[]) {
  const [reading, setReading] = useState(weeks[0]?.weekStart);
  useEffect(() => {
    const scroller = document.getElementById("app-scroll");
    if (!scroller) return;
    let frame = 0;
    const track = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = scroller.getBoundingClientRect().top + 8;
        let current: string | undefined;
        for (const section of document.querySelectorAll<HTMLElement>(".profile-week")) {
          if (section.getBoundingClientRect().top > top) break;
          current = section.dataset.week;
        }
        setReading(current ?? weeks[0]?.weekStart);
      });
    };
    track();
    scroller.addEventListener("scroll", track, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", track);
    };
  }, [weeks]);
  return reading;
}
/**
 * Picks which of the person's lists to show. Starred (other people's links you kept) sits
 * apart and only on your own profile, which can also start a new group here.
 */
function ListFilter({
  groups,
  filter,
  own,
  onSelect,
  onNewGroup,
}: {
  groups: Group[];
  filter: string;
  own: boolean;
  onSelect: (value: string) => void;
  onNewGroup: (trigger?: HTMLButtonElement | null) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  // Favorites first, then the person's groups, like Settings.
  const lists = groups
      .filter((g) => g.kind !== "starred")
      .sort((a, b) => Number(b.kind === "favorites") - Number(a.kind === "favorites")),
    chosen = lists.find((g) => g.id === filter);
  const name =
    filter === "all" ? "All" : filter === "starred" ? "Starred" : (chosen?.name ?? "All");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className={
              "list-filter gap-1.5 mr-[-8px] p-[0_8px] text-[14px] font-medium text-foreground [&_svg]:text-subtle-foreground [&_svg:last-child]:w-4 [&_svg:last-child]:h-4 [&_svg:last-child]:[transition:transform_150ms_ease] [&[aria-expanded='true']_svg:last-child]:[transform:rotate(180deg)]"
            }
            ref={trigger}
            aria-label={"Showing " + name}
          />
        }
      >
        {chosen?.visibility === "private" && <LockKeyhole size={13} aria-hidden="true" />}
        {name}
        <ChevronDown aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="list-filter-menu">
        <DropdownMenuRadioGroup value={filter} onValueChange={(value) => onSelect(String(value))}>
          <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
          {lists.map((g) => (
            <DropdownMenuRadioItem key={g.id} value={g.id}>
              {g.visibility === "private" && <LockKeyhole aria-hidden="true" />}
              {g.name}
            </DropdownMenuRadioItem>
          ))}
          {own && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuRadioItem value="starred">
                <Star aria-hidden="true" />
                Starred
              </DropdownMenuRadioItem>
            </>
          )}
        </DropdownMenuRadioGroup>
        {own && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onNewGroup(trigger.current)}>
              <Plus />
              New group
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
