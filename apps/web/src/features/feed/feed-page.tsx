import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Plus } from "lucide-react";
import { Button } from "@index/ui/components/button";
import {
  Heading,
  IconButton,
  MessagesLink,
  QueryState,
  UserAvatar,
  More,
} from "@/components/app/primitives";
import { LinkRow } from "@/features/links/link-row";
import { useWeekLinks } from "@/features/links/hooks/use-links";
import { useFeed } from "./hooks/use-feed";
import { useWeekPager } from "./hooks/use-week-pager";
import { useProfile } from "@/features/profiles/hooks/use-profiles";
import { useViewer } from "@/hooks/use-api";
import { useUnread } from "@/features/activity/hooks/use-activity";
import { monday, weekLabel } from "@/lib/weeks";
import type { Person, SavedLink } from "@/lib/types";
export function WeekLinks({
  userId,
  week,
  groupId,
  inbox = false,
  add = false,
  seed,
  updatedAt,
}: {
  userId: string;
  week: string;
  groupId?: string;
  inbox?: boolean;
  add?: boolean;
  seed?: { items: SavedLink[]; nextCursor: string | null };
  updatedAt?: number;
}) {
  const list = useWeekLinks(userId, week, groupId, inbox, seed, updatedAt);
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
        <Link
          to="/add"
          search={{ week, group: groupId }}
          className="add-row"
          aria-label={"Add link to " + weekLabel(week)}
        >
          <Plus size={20} />
          <span className="sr-only">Add link</span>
        </Link>
      )}
      <QueryState pending={list.isPending} error={list.error} retry={() => void list.refetch()}>
        {list.data?.pages
          .flatMap((p) => p.items)
          .map((link) => (
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
  const { viewport, weeks, move } = useWeekPager(week);
  return (
    <>
      <IconButton
        className="week-navigation week-navigation-newer"
        label="Newer week"
        disabled={week >= monday()}
        onClick={() => move(1)}
      >
        <ChevronUp />
      </IconButton>
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
      <IconButton
        className="week-navigation week-navigation-older"
        label="Older week"
        onClick={() => move(-1)}
      >
        <ChevronDown />
      </IconButton>
    </>
  );
}

function WeekContent({ week, followingCount }: { week: string; followingCount?: number | null }) {
  const viewer = useViewer()!,
    feed = useFeed(week),
    unread = useUnread();
  const carousel = useRef<HTMLDivElement>(null);
  const ownEmpty = feed.data?.pages[0]?.own.items.length === 0;
  const people = feed.data?.pages.flatMap((page) => page.people) ?? [];
  const friendsEmpty = !!feed.data && people.length === 0;
  return (
    <div className="week-stage" data-own-empty={ownEmpty} data-friends-empty={friendsEmpty}>
      <Heading actions={<MessagesLink unread={unread.messages} />}>{weekLabel(week)}</Heading>
      <div className="own-links">
        {ownEmpty ? (
          <div className="week-empty-own">
            <h2>
              {week === monday() ? "What caught your eye this week?" : "No links saved this week."}
            </h2>
            <p>
              {week === monday()
                ? "Save something worth coming back to."
                : "There’s still room for something worth keeping."}
            </p>
            <Button
              nativeButton={false}
              role="link"
              render={<Link to="/add" search={{ week }} />}
              className="week-empty-add"
            >
              <Plus size={17} /> Add a link
            </Button>
          </div>
        ) : (
          <WeekLinks
            userId={viewer.id}
            week={week}
            add
            seed={feed.data?.pages[0]?.own}
            updatedAt={feed.dataUpdatedAt}
          />
        )}
      </div>
      <div className="carousel-controls">
        {!friendsEmpty && (
          <>
            <span className="sr-only">People you follow</span>
            <IconButton
              label="Previous person"
              onClick={() => carousel.current?.scrollBy({ left: -350, behavior: "smooth" })}
            >
              <ChevronLeft />
            </IconButton>
            <IconButton
              label="Next person"
              onClick={() => carousel.current?.scrollBy({ left: 350, behavior: "smooth" })}
            >
              <ChevronRight />
            </IconButton>
          </>
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
            carousel.current?.scrollBy({
              left: e.key === "ArrowRight" ? 350 : -350,
              behavior: "smooth",
            });
          }
        }}
      >
        <QueryState pending={feed.isPending} error={feed.error} retry={() => void feed.refetch()}>
          {feed.data?.pages
            .flatMap((p) => p.people)
            .map((p) => (
              <FriendCard
                key={week + p.author.id}
                person={p.author}
                week={week}
                seed={p.links}
                updatedAt={feed.dataUpdatedAt}
              />
            ))}
          {friendsEmpty && (
            <div className="week-empty-friends">
              <span className="week-section-label">Your people</span>
              <h2>
                {followingCount === 0
                  ? "Find people whose taste you trust."
                  : "Nothing shared this week yet."}
              </h2>
              <p>Links from people you follow will appear here.</p>
              {followingCount === 0 && (
                <Link to="/discover">
                  Discover people <ChevronRight size={15} />
                </Link>
              )}
            </div>
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
    </div>
  );
}
