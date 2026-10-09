import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { Button } from "@index/ui/components/button";
import { Heading, IconButton, QueryState, UserAvatar, More } from "@/components/app/primitives";
import { LinkRow } from "@/features/links/link-row";
import { QuickAdd } from "@/features/links/quick-add";
import { useWeekLinks } from "@/features/links/hooks/use-links";
import { useFeed } from "./hooks/use-feed";
import { usePeeking } from "./hooks/use-peeking";
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
  const edges = useScrollEdges(panel, links.length, "y");
  const scrollToTop = () => panel.current?.scrollTo({ top: 0, behavior: "smooth" });
  // New links show up first, so bring the top into view: right away when saving from the field
  // (its pending row sits just above the list), and on arrival for links added elsewhere.
  const seen = useRef<Set<string>>(null);
  useEffect(() => {
    const first = links[0]?.id;
    if (seen.current && first && !seen.current.has(first)) scrollToTop();
    seen.current = new Set(links.map((link) => link.id));
  }, [list.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // The next page loads as the end of the list comes near; a failed load offers a retry instead.
  const end = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = list;
  useEffect(() => {
    const root = panel.current,
      target = end.current;
    if (!root || !target || !hasNextPage || isFetchingNextPage || isFetchNextPageError) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry?.isIntersecting && void fetchNextPage(),
      { root, rootMargin: "0px 0px 100% 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [links.length, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
  return (
    <>
      {/* Outside the scrolling list, so adding stays in reach however long the week gets. */}
      {add && (
        <QuickAdd
          groupId={groupId}
          links={links}
          label={"Enter a link to add it to " + weekLabel(week)}
          onSave={scrollToTop}
        />
      )}
      {/* Takes the space left under the field; the list inside shows whole rows of it. */}
      <div className="link-area">
        <div
          ref={panel}
          className="link-list"
          data-scroll-panel
          data-fade-start={edges.before || undefined}
          data-fade-end={edges.after || undefined}
          tabIndex={edges.before || edges.after ? 0 : undefined}
          aria-label={"Links in " + weekLabel(week)}
        >
          {/* A fixed snap point at the top. Otherwise the list snaps to its first row and holds on
              to it, so a new link added above would push the list down a row and back. */}
          <div className="link-list-start" />
          <QueryState pending={list.isPending} error={list.error} retry={() => void list.refetch()}>
            {links.map((link) => (
              <LinkRow key={link.id} link={link} />
            ))}
            {list.data?.pages[0]?.items.length === 0 && !add && (
              <p className="empty-state">No links this week.</p>
            )}
            <div ref={end} className="link-list-end" />
            {isFetchingNextPage && <p className="link-list-loading">Loading…</p>}
            {isFetchNextPageError && (
              <More hasNext isFetching={isFetchingNextPage} fetch={fetchNextPage} />
            )}
          </QueryState>
        </div>
      </div>
    </>
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
/** Holds a person's place, so the zone keeps its shape when nobody has shared anything. */
function NoPeople({ discover, current }: { discover: boolean; current: boolean }) {
  return (
    <div className="friend-card friend-card-empty">
      <p>
        {discover
          ? "Find people whose taste you trust"
          : current
            ? "Nothing shared this week yet"
            : "Nothing shared this week"}
      </p>
      {discover && (
        <Link to="/discover" aria-label="Discover people">
          Discover
        </Link>
      )}
    </div>
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
  usePeeking(carousel, people.length);
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
        {ownEmpty && !current ? (
          <p className="week-empty">Nothing saved this week.</p>
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
            <IconButton
              className="carousel-previous"
              label="Previous person"
              onClick={() => scrollPeople(-1)}
            >
              <ChevronLeft />
            </IconButton>
          )}
          {edges.after && (
            <IconButton
              className="carousel-next"
              label="Next person"
              onClick={() => scrollPeople(1)}
            >
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
            {friendsEmpty && <NoPeople discover={followingCount === 0} current={current} />}
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
