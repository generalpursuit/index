import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
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
import { Back, UserAvatar, QueryState, Modal } from "@/components/app/primitives";
import { useViewer } from "@/hooks/use-api";
import { useProfile, useProfileActions } from "./hooks/use-profiles";
import { useGroups, useLibraryWeeks } from "@/features/links/hooks/use-links";
import { WeekLinks } from "@/features/feed/feed-page";
import { NewGroup } from "@/features/settings/groups";
import { monday, weekLabel, weekRange } from "@/lib/weeks";
import { Connections } from "./connections";
import type { Profile, Person, Group } from "@/lib/types";
const count = (n: number, noun: string) => n + " " + noun + (n === 1 ? "" : "s");
export function FollowButton({ person }: { person: Person }) {
  const viewer = useViewer(),
    profile = useProfile(person.id),
    actions = useProfileActions();
  if (viewer?.id === person.id) return null;
  if (!viewer)
    return (
      <Link className="pill" to="/login">
        Sign in to follow
      </Link>
    );
  const status = profile.data?.followingStatus;
  return (
    <Button
      variant="outline"
      disabled={profile.isPending || actions.follow.isPending || actions.unfollow.isPending}
      onClick={() =>
        status
          ? actions.unfollow.mutate({ userId: person.id })
          : actions.follow.mutate({ userId: person.id })
      }
    >
      {status === "accepted"
        ? "Following"
        : status === "pending"
          ? "Requested"
          : person.profileVisibility === "private"
            ? "Request"
            : "Follow"}
    </Button>
  );
}
export function ProfilePage({ userId, group = "all" }: { userId: string; group?: string }) {
  const profile = useProfile(userId);
  return (
    <QueryState
      pending={profile.isPending}
      error={profile.error}
      retry={() => void profile.refetch()}
    >
      {profile.data && <ProfileContent key={userId} profile={profile.data} filter={group} />}
    </QueryState>
  );
}
function ProfileContent({ profile, filter }: { profile: Profile; filter: string }) {
  const viewer = useViewer(),
    own = viewer?.id === profile.id,
    navigate = useNavigate();
  const [connections, setConnections] = useState<"followers" | "following" | null>(null),
    [newGroup, setNewGroup] = useState(false);
  const hidden = !profile.canViewContent;
  return (
    <div className="profile-page">
      {!own && <Back fallback="/discover" />}
      <header className="profile-heading">
        <UserAvatar person={profile} large />
        <div className="profile-identity">
          <div className="profile-name">
            <h1>{profile.name}</h1>
            <span
              className="profile-visibility"
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
          <p className="profile-meta">
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
        <div className="heading-actions">
          {own ? (
            <Link to="/settings" className="icon-link" aria-label="Settings" title="Settings">
              <Settings />
            </Link>
          ) : (
            !hidden && <FollowButton person={profile} />
          )}
        </div>
      </header>
      {!own && profile.followedBy.total > 0 && (
        <p className="muted social-context">
          <FollowedBy context={profile.followedBy} linked />
        </p>
      )}
      {hidden ? (
        <div className="private-profile">
          <LockKeyhole size={32} />
          <h2>Private profile</h2>
          <p className="muted">Only {profile.name}’s followers can view their posts.</p>
          <FollowButton person={profile} />
        </div>
      ) : (
        <ProfileLinks
          key={filter}
          userId={profile.id}
          own={own}
          filter={filter}
          onNewGroup={() => setNewGroup(true)}
        />
      )}
      {connections && <Connections initial={connections} onClose={() => setConnections(null)} />}
      {newGroup && (
        <NewGroup
          onClose={() => setNewGroup(false)}
          onCreated={(id) => {
            setNewGroup(false);
            void navigate({ to: ".", search: (old) => ({ ...old, group: id }) });
          }}
        />
      )}
    </div>
  );
}
type Week = { weekStart: string; count: number };
/**
 * One person's links as one continuous list of weeks. Each week's heading sticks while you
 * read it, the list filter rides at the end of that sticky row, and the scrubber (or the week
 * title) jumps to any week. Weeks with nothing in the chosen list are skipped.
 */
function ProfileLinks({
  userId,
  own,
  filter,
  onNewGroup,
}: {
  userId: string;
  own: boolean;
  filter: string;
  onNewGroup: () => void;
}) {
  const groups = useGroups(userId),
    allGroups = groups.data?.pages.flatMap((p) => p.items) ?? [],
    selected = allGroups.find((g) => g.id === filter),
    starredGroup = allGroups.find((g) => g.kind === "starred");
  // A chosen list is known once groups load. Starred has no group until something is starred,
  // and a deleted group has none either; both simply show as empty.
  const ready = filter === "all" || !!groups.data,
    missing = ready && filter !== "all" && !selected;
  const list = useLibraryWeeks(userId, selected?.id, filter === "all" || !!selected),
    canAdd = own && (filter === "all" || selected?.kind === "custom");
  // The scrubber shows every week, and the list is small (one entry per week): load it all.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const loaded = list.data?.pages.flatMap((p) => p.items) ?? [];
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
  const navigate = useNavigate();
  const select = (group?: string) =>
    void navigate({
      to: ".",
      search: (old) => ({ ...old, group: group === "all" ? undefined : group }),
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
    <div ref={listRef} className="profile-links">
      {groups.error && <QueryState error={groups.error} retry={() => void groups.refetch()} />}
      <QueryState
        pending={!ready || (!missing && (list.isPending || hasNextPage))}
        error={list.error}
        retry={() => void list.refetch()}
      >
        {weeks.length ? (
          <>
            {/* No height of its own: the menu sits over the end of whichever heading sticks. */}
            <div className="profile-list-bar">{filterMenu}</div>
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
            <WeekScrubber weeks={weeks} onJump={jump} />
          </>
        ) : (
          <>
            <div className="profile-week-heading">{filterMenu}</div>
            <div className="empty-box">
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
      <Modal open={picking} onOpenChange={setPicking} title="Weeks">
        <ul className="week-picker">
          {weeks.map((w) => (
            <li key={w.weekStart}>
              <button
                type="button"
                onClick={() => {
                  setPicking(false);
                  // After the sheet lets go of the page.
                  requestAnimationFrame(() => jump(w.weekStart));
                }}
              >
                <strong>{weekLabel(w.weekStart)}</strong>
                <span>{weekRange(w.weekStart)}</span>
                <small>{w.count === 1 ? "1 link" : w.count + " links"}</small>
              </button>
            </li>
          ))}
        </ul>
      </Modal>
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
      className="profile-week"
      data-week={week.weekStart}
      aria-label={weekLabel(week.weekStart)}
    >
      <div className="profile-week-heading">
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
          className="profile-week-placeholder"
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
/**
 * Pointer shortcut along the right of the list: one tick per week, the week you are reading
 * drawn longer. Hovering names a week; clicking jumps there. The week titles open the same
 * choice as a list, for keyboards, screen readers and phones.
 */
function WeekScrubber({ weeks, onJump }: { weeks: Week[]; onJump: (week: string) => void }) {
  const [active, setActive] = useState(weeks[0]?.weekStart);
  const [hovered, setHovered] = useState<{ week: string; top: number; inside: boolean } | null>(
    null,
  );
  const label = useRef<HTMLDivElement>(null);
  // Every range this list can show, stacked unseen under the label, so it keeps one size.
  const ranges = useMemo(() => [...new Set(weeks.map((w) => weekRange(w.weekStart)))], [weeks]);
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
        setActive(current ?? weeks[0]?.weekStart);
      });
    };
    track();
    scroller.addEventListener("scroll", track, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", track);
    };
  }, [weeks]);
  if (weeks.length < 2) return null;
  return (
    <div
      className="week-scrubber"
      aria-hidden="true"
      style={{ "--weeks": weeks.length } as CSSProperties}
      onPointerLeave={() => setHovered(null)}
    >
      {weeks.map((w) => (
        <button
          key={w.weekStart}
          type="button"
          tabIndex={-1}
          className="week-tick"
          data-active={w.weekStart === active || undefined}
          onPointerEnter={(e) => {
            // The label opens into the gutter when it fits, otherwise over the end of the rows.
            const room = innerWidth - e.currentTarget.getBoundingClientRect().right - 16;
            setHovered({
              week: w.weekStart,
              top: e.currentTarget.offsetTop + e.currentTarget.offsetHeight / 2,
              inside: (label.current?.offsetWidth ?? 0) + 8 > room,
            });
          }}
          onClick={() => onJump(w.weekStart)}
        />
      ))}
      <div
        ref={label}
        className="week-tick-label"
        data-visible={hovered ? true : undefined}
        data-inside={hovered?.inside || undefined}
        style={{ top: hovered?.top ?? 0 }}
      >
        <strong className="size-stack">
          <span>{hovered && weekLabel(hovered.week)}</span>
          <span className="size-stack-ghost">Week 53</span>
        </strong>
        <span className="size-stack">
          <span>{hovered && weekRange(hovered.week)}</span>
          {ranges.map((range) => (
            <span key={range} className="size-stack-ghost">
              {range}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
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
  onNewGroup: () => void;
}) {
  const lists = groups.filter((g) => g.kind !== "starred"),
    chosen = lists.find((g) => g.id === filter);
  const name =
    filter === "all" ? "All" : filter === "starred" ? "Starred" : (chosen?.name ?? "All");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" className="list-filter" aria-label={"Showing " + name} />}
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
            <DropdownMenuItem onClick={onNewGroup}>
              <Plus />
              New group
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
