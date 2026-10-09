import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { Button } from "@index/ui/components/button";
import { Heading, IconButton, QueryState, UserAvatar, More } from "@/components/app/primitives";
import { LinkRow } from "@/features/links/link-row";
import { QuickAdd } from "@/features/links/quick-add";
import { useWeekLinks } from "@/features/links/hooks/use-links";
import { useFeed } from "./hooks/use-feed";
import { useScrollEdges } from "./hooks/use-scroll-edges";
import { useWeekPager } from "./hooks/use-week-pager";
import { useProfile } from "@/features/profiles/hooks/use-profiles";
import { useViewer } from "@/hooks/use-api";
import { monday, weekLabel } from "@/lib/weeks";
import type { Person, SavedLink } from "@/lib/types";
export function WeekLinks({
  userId,
  week,
  groupId,
  add = false,
  seed,
  updatedAt,
}: {
  userId: string;
  week: string;
  groupId?: string;
  add?: boolean;
  seed?: { items: SavedLink[]; nextCursor: string | null };
  updatedAt?: number;
}) {
  const list = useWeekLinks(userId, week, groupId, seed, updatedAt);
  const links = list.data?.pages.flatMap((p) => p.items) ?? [];
  const panel = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    const measure = () => setScrollable(element.scrollHeight > element.clientHeight + 1);
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    return () => resize.disconnect();
  }, [list.data]);
  return (
    <div
      ref={panel}
      className="link-list"
      data-scroll-panel
      tabIndex={scrollable ? 0 : undefined}
      aria-label={"Links in " + weekLabel(week)}
    >
      {add && (
        <QuickAdd
          groupId={groupId}
          links={links}
          label={"Enter a link to add it to " + weekLabel(week)}
        />
      )}
      <QueryState pending={list.isPending} error={list.error} retry={() => void list.refetch()}>
        {links.map((link) => (
          <LinkRow key={link.id} link={link} />
        ))}
        {list.data?.pages[0]?.items.length === 0 && !add && (
          <p className="empty-state">No links this week.</p>
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
function FriendCard({
  person,
  week,
  seed,
  updatedAt,
}: {
  person: Person;
  week: string;
  seed: { items: SavedLink[]; nextCursor: string | null };
  updatedAt: number;
}) {
  return (
    <article className="friend-card">
      <Link className="person-inline" to="/people/$userId" params={{ userId: person.id }}>
        <UserAvatar person={person} />
        <strong>{person.username ?? person.name}</strong>
      </Link>
      <div className="friend-links">
        <WeekLinks userId={person.id} week={week} seed={seed} updatedAt={updatedAt} />
      </div>
    </article>
  );
}
export function FeedPage({ week }: { week: string }) {
  const viewer = useViewer()!;
  const profile = useProfile(viewer.id);
  const neighbors = useFeed(week).data?.pages[0];
  const { viewport, weeks, move } = useWeekPager(week, neighbors);
  return (
    <div className="week-feed">
      <Heading>{weekLabel(week)}</Heading>
      {neighbors?.newerWeek && (
        <IconButton
          className="week-navigation week-navigation-newer"
          label="Newer week"
          onClick={() => move(1)}
        >
          <ChevronUp />
        </IconButton>
      )}
      <div ref={viewport} className="week-pager" role="region" aria-label="Weekly feed">
        {weeks.map((date) => (
          <section
            key={date}
            className="week-page"
            data-week={date}
            data-active={date === week}
            inert={date !== week}
            aria-hidden={date !== week}
          >
            <WeekContent week={date} followingCount={profile.data?.followingCount} />
          </section>
        ))}
      </div>
      {neighbors?.olderWeek && (
        <IconButton
          className="week-navigation week-navigation-older"
          label="Older week"
          onClick={() => move(-1)}
        >
          <ChevronDown />
        </IconButton>
      )}
    </div>
  );
}

function WeekContent({ week, followingCount }: { week: string; followingCount?: number | null }) {
  const viewer = useViewer()!,
    feed = useFeed(week);
  const carousel = useRef<HTMLDivElement>(null);
  const ownEmpty = feed.data?.pages[0]?.own.items.length === 0;
  const people = feed.data?.pages.flatMap((page) => page.people) ?? [];
  const friendsEmpty = !!feed.data && people.length === 0;
  const edges = useScrollEdges(carousel, people.length);
  const current = week === monday();
  // One step moves the carousel by a whole column, whatever the layout's column width.
  const scrollPeople = (direction: 1 | -1) => {
    const element = carousel.current,
      card = element?.querySelector<HTMLElement>(".friend-card");
    if (!element || !card) return;
    const gap = parseFloat(getComputedStyle(element).columnGap) || 0;
    element.scrollBy({ left: direction * (card.offsetWidth + gap), behavior: "smooth" });
  };
  return (
    <div className="week-stage">
      {/* The layout makes both sections clear; their names remain for assistive technology. */}
      <section className="own-links" aria-labelledby={"yours-" + week}>
        <h2 id={"yours-" + week} className="sr-only">
          Yours
        </h2>
        {ownEmpty ? (
          <p className="week-empty">
            {current ? (
              <>
                What caught your eye this week?{" "}
                <Link to="." search={(old) => ({ ...old, add: true })}>
                  Add a link
                </Link>
              </>
            ) : (
              "Nothing saved this week."
            )}
          </p>
        ) : (
          <WeekLinks
            userId={viewer.id}
            week={week}
            add={current}
            seed={feed.data?.pages[0]?.own}
            updatedAt={feed.dataUpdatedAt}
          />
        )}
      </section>
      <section className="people" aria-labelledby={"people-" + week}>
        <h2 id={"people-" + week} className="sr-only">
          Your people
        </h2>
        <div className="carousel-controls">
          {edges.before && (
            <IconButton label="Previous person" onClick={() => scrollPeople(-1)}>
              <ChevronLeft />
            </IconButton>
          )}
          {edges.after && (
            <IconButton label="Next person" onClick={() => scrollPeople(1)}>
              <ChevronRight />
            </IconButton>
          )}
        </div>
        <div
          ref={carousel}
          className="friends-carousel"
          aria-label="Friends’ links"
          tabIndex={friendsEmpty ? undefined : 0}
          onKeyDown={(e) => {
            if (e.target === e.currentTarget && ["ArrowLeft", "ArrowRight"].includes(e.key)) {
              e.preventDefault();
              scrollPeople(e.key === "ArrowRight" ? 1 : -1);
            }
          }}
        >
          <QueryState pending={feed.isPending} error={feed.error} retry={() => void feed.refetch()}>
            {people.map((p) => (
              <FriendCard
                key={week + p.author.id}
                person={p.author}
                week={week}
                seed={p.links}
                updatedAt={feed.dataUpdatedAt}
              />
            ))}
            {friendsEmpty && (
              <p className="week-empty">
                {followingCount === 0
                  ? "Find people whose taste you trust."
                  : "Nothing shared this week yet."}{" "}
                {followingCount === 0 && <Link to="/discover">Discover people</Link>}
              </p>
            )}
            {feed.hasNextPage && (
              <Button
                variant="outline"
                onClick={() => void feed.fetchNextPage()}
                disabled={feed.isFetchingNextPage}
              >
                More people
              </Button>
            )}
          </QueryState>
        </div>
      </section>
    </div>
  );
}
