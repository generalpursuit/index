import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@index/ui/components/button";
import { Heading } from "@/components/app/navigation";
import { QueryState } from "@/components/app/query-state";
import { UserAvatar } from "@/components/app/user-avatar";
import { WeekLinks } from "@/features/links/week-links";
import { useFeed, useFeedWeeks } from "./hooks/use-feed";
import { usePeeking } from "./hooks/use-peeking";
import { WeekPager } from "@/components/app/week-pager";
import { WeekPicker } from "@/components/app/week-scrubber";
import { useProfile } from "@/features/profiles/hooks/use-profiles";
import { useViewer } from "@/hooks/use-api";
import { monday, weekLabel } from "@/lib/weeks";
import type { Person, SavedLink } from "@/lib/types";
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
    <article
      className={
        "friend-card [flex:0_0_calc((100%_-_16px)_/_2)] min-w-0 h-full flex flex-col gap-1 p-[var(--person-top)_14px_6px] [scroll-snap-align:start] [transition:opacity_150ms_ease] [&[data-peeking]]:opacity-[0.3] [&[data-peeking]]:cursor-pointer [&[data-peeking]_*]:cursor-pointer [&[data-peeking]:hover]:opacity-[0.55] [&>.person-inline]:flex-none [&>.person-inline]:h-[var(--person-heading-height)] [&_.user-avatar]:w-8 [&_.user-avatar]:h-8"
      }
    >
      <Link
        className={"person-inline flex items-center gap-3 min-w-0 [&_strong]:font-medium"}
        to="/u/$username"
        params={{ username: person.username! }}
      >
        <UserAvatar person={person} />
        <strong>{person.username ?? person.name}</strong>
      </Link>
      <div className={"friend-links flex-1 min-h-0 flex flex-col"}>
        <WeekLinks userId={person.id} week={week} seed={seed} updatedAt={updatedAt} />
      </div>
    </article>
  );
}
/** Holds a person's place, so the zone keeps its shape when nobody has shared anything. */
function NoPeople({ discover, current }: { discover: boolean; current: boolean }) {
  return (
    <div
      className={
        "friend-card [flex:0_0_calc((100%_-_16px)_/_2)] min-w-0 h-full flex flex-col gap-1 p-[var(--person-top)_14px_6px] [scroll-snap-align:start] [transition:opacity_150ms_ease] [&[data-peeking]]:opacity-[0.3] [&[data-peeking]]:cursor-pointer [&[data-peeking]_*]:cursor-pointer [&[data-peeking]:hover]:opacity-[0.55] [&>.person-inline]:flex-none [&>.person-inline]:h-[var(--person-heading-height)] [&_.user-avatar]:w-8 [&_.user-avatar]:h-8 empty-box flex flex-col justify-center items-center gap-3 min-h-40 p-6 text-subtle-foreground text-center [&_a]:text-foreground [&_a:hover]:underline [&_a:hover]:underline-offset-[4px]"
      }
    >
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
  const navigate = useNavigate();
  const neighbors = useFeed(week).data?.pages[0];
  const weekIndex = useFeedWeeks();
  const weeks = weekIndex.weeks;
  const [picking, setPicking] = useState(false);
  const go = (next: string) =>
    void navigate({ to: "/", search: { week: next }, replace: true, resetScroll: false });
  return (
    <div
      className={
        "week-feed h-full min-h-0 grid grid-rows-[auto_minmax(0,_1fr)] pt-[var(--page-top-space)] gap-7 [&>.page-heading]:m-0 [@media(width<=700px)]:gap-5 [@media(width<=700px)_and_(height<=740px)]:gap-3.5 [&>.page-heading_h1]:font-serif [&>.page-heading_h1]:font-bold [&>.page-heading_h1]:[font-variation-settings:'opsz'_60] [&>.page-heading_h1]:tracking-[-0.015em] [&>.page-heading_h1]:leading-[1] [&>.page-heading_h1]:text-[clamp(44px,_5vw,_62px)] [@media(width<=700px)_and_(height<=740px)]:[&>.page-heading_h1]:text-[36px]"
      }
    >
      <Heading>
        <button
          type="button"
          className={"week-title [font:inherit] tracking-[inherit] [color:inherit] text-left"}
          aria-label={weekLabel(week) + ", jump to a week"}
          onClick={() => setPicking(true)}
        >
          {weekLabel(week)}
        </button>
      </Heading>
      <WeekPager week={week} weeks={weeks} neighbors={neighbors} label="Weekly feed" go={go}>
        {(date) => <WeekContent week={date} followingCount={profile.data?.followingCount} />}
      </WeekPager>
      {weekIndex.error && (
        <p role="status" className="text-sm text-subtle-foreground">
          Couldn’t load all weeks.{" "}
          <button
            type="button"
            className="underline"
            onClick={() =>
              void (weekIndex.isFetchNextPageError
                ? weekIndex.fetchNextPage()
                : weekIndex.refetch())
            }
          >
            Retry weeks
          </button>
        </p>
      )}
      <WeekPicker open={picking} onOpenChange={setPicking} weeks={weeks} onPick={go} />
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
  usePeeking(carousel, people.length);
  // More people load as the end of the carousel comes near; a failed load offers a retry.
  const end = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = feed;
  useEffect(() => {
    const root = carousel.current,
      target = end.current;
    if (!root || !target || !hasNextPage || isFetchingNextPage || isFetchNextPageError) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry?.isIntersecting && void fetchNextPage(),
      { root, rootMargin: "0px 100% 0px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [people.length, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
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
    <div
      className={
        "week-stage h-full grid grid-rows-[minmax(0,_1fr)_minmax(0,_1fr)] min-h-0 gap-7 [--row:48px] [&_:is(.link-row,_.quick-add)]:min-h-[var(--row)] [&_.friend-card.empty-box]:justify-center [&_.friend-card.empty-box]:gap-3 [&_.friend-card.empty-box]:p-6 [&_.friend-card.empty-box]:border [&_.friend-card.empty-box]:border-border [&_.friend-card.empty-box]:rounded-[18px] [@media(width<=700px)]:gap-5 [@media(width<=700px)]:grid-rows-[minmax(0,_1fr)_minmax(0,_1fr)] [@media(width<=700px)]:[--row:46px] [@media(width<=700px)_and_(height<=740px)]:grid-rows-[minmax(0,_0.85fr)_minmax(0,_1.15fr)] [@media(width<=700px)_and_(height<=740px)]:gap-3.5 [@media(width<=700px)_and_(height<=740px)]:[--row:36px] [@media(width<=700px)_and_(height<=740px)]:[&_.people]:[--person-top:8px] [@media(width<=700px)_and_(height<=740px)]:[&_.people]:[--person-heading-height:28px] [@media(width<=700px)_and_(height<=740px)]:[&_.friend-card]:p-[var(--person-top)_12px_2px] [@media(width<=700px)_and_(height<=740px)]:[&_.friend-card]:gap-1 [@media(width<=700px)_and_(height<=740px)]:[&_.link-row]:[--mark-column:28px] [@media(width<=700px)_and_(height<=740px)]:[&_.friend-card_.user-avatar]:w-7 [@media(width<=700px)_and_(height<=740px)]:[&_.friend-card_.user-avatar]:h-7 [@media(width<=700px)_and_(height<=740px)]:[&_.link-open]:text-[12px] [@media(width<=700px)_and_(height<=740px)]:[&_.quick-add]:text-[12px] [@media(width<=700px)_and_(height<=740px)]:[&_.link-domain]:text-[10px]"
      }
    >
      {/* The layout makes both sections clear; their names remain for assistive technology. */}
      <section
        className={"own-links min-h-0 max-w-full flex flex-col"}
        aria-labelledby={"yours-" + week}
      >
        <h2 id={"yours-" + week} className="sr-only">
          Yours
        </h2>
        {ownEmpty && !current ? (
          <p
            className={
              "week-empty p-[4px_0_12px] text-subtle-foreground leading-[1.6] [&_a]:text-foreground [&_a]:whitespace-nowrap [&_a:hover]:underline [&_a:hover]:underline-offset-[4px]"
            }
          >
            Nothing saved this week.
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
      <section
        className={
          "people [--person-top:12px] [--person-heading-height:36px] relative min-h-0 grid grid-rows-[minmax(0,_1fr)]"
        }
        aria-labelledby={"people-" + week}
      >
        <h2 id={"people-" + week} className="sr-only">
          Your people
        </h2>
        <div
          ref={carousel}
          className={
            "friends-carousel [scrollbar-width:none] flex items-start overflow-x-auto overflow-y-hidden gap-4 [scroll-snap-type:x_mandatory] min-h-0 [overscroll-behavior-x:contain] [&::-webkit-scrollbar]:hidden [&:has(>_.friend-card:nth-child(3))>.friend-card]:basis-[calc((100%_-_32px)_/_2.2)] [@media(width<=700px)]:[&>.friend-card]:basis-[calc(100vw_-_74px)] [@media(width<=700px)]:[&:has(>_.friend-card:nth-child(3))>.friend-card]:basis-[calc(100vw_-_74px)] [@media(width<=700px)]:gap-4"
          }
          aria-label="Friends’ links"
          tabIndex={friendsEmpty ? undefined : 0}
          // A box peeking in at either edge is the way there: clicking it brings it into view
          // (instead of opening what is half hidden inside it).
          onClickCapture={(e) => {
            const box = (e.target as HTMLElement).closest<HTMLElement>(".friend-card");
            if (!box?.hasAttribute("data-peeking")) return;
            e.preventDefault();
            e.stopPropagation();
            const edge = e.currentTarget.getBoundingClientRect();
            scrollPeople(box.getBoundingClientRect().left < edge.left ? -1 : 1);
          }}
          onKeyDown={(e) => {
            if (e.target === e.currentTarget && ["ArrowLeft", "ArrowRight"].includes(e.key)) {
              e.preventDefault();
              scrollPeople(e.key === "ArrowRight" ? 1 : -1);
            }
          }}
        >
          <QueryState
            pending={feed.isPending}
            hasData={!!feed.data}
            error={feed.error}
            retry={() => void feed.refetch()}
          >
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
            <div
              ref={end}
              className={"carousel-end flex-none w-0 ml-[-16px] self-stretch"}
              aria-hidden="true"
            />
            {isFetchNextPageError && (
              <Button
                variant="outline"
                className={"carousel-retry flex-none self-center"}
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                Try again
              </Button>
            )}
          </QueryState>
        </div>
      </section>
    </div>
  );
}
