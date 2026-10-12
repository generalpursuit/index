import { useEffect, useRef, type ReactNode } from "react";
import { QueryState, More } from "@/components/app/query-state";
import { LinkRow } from "./link-row";
import { QuickAdd } from "./quick-add";
import { ownerOf, useWeekLinks } from "./hooks/use-links";
import { useScrollEdges } from "./hooks/use-scroll-edges";
import { weekLabel } from "@/lib/weeks";
import type { SavedLink } from "@/lib/types";
export function WeekLinks({
  userId,
  week,
  groupId,
  add = false,
  seed,
  updatedAt,
  showOwners = false,
  lockedGroups,
  placeholder,
}: {
  userId: string;
  week: string;
  groupId?: string;
  add?: boolean;
  seed?: { items: SavedLink[]; nextCursor: string | null };
  updatedAt?: number;
  /** Name whose link each row is, for lists of other people's links. */
  showOwners?: boolean;
  /** Your locked groups; their links show a lock. */
  lockedGroups?: ReadonlySet<string>;
  /** Shown while the links load, sized like them. */
  placeholder?: ReactNode;
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
      <div
        className={
          "link-area flex-1 min-h-0 [&>.link-list]:max-h-[round(down,_100%,_var(--row))] [&>.link-list]:overflow-y-auto [&>.link-list]:[scroll-snap-type:y_proximity] [&>.link-list>*]:[scroll-snap-align:start]"
        }
      >
        <div
          ref={panel}
          className={
            "link-list min-h-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&:is([data-fade-start],_[data-fade-end])]:[mask-image:linear-gradient(_to_bottom,_transparent,_#000_var(--fade-start,_0px),_#000_calc(100%_-_var(--fade-end,_0px)),_transparent_)] [&[data-fade-start]]:[--fade-start:var(--row,_48px)] [&[data-fade-end]]:[--fade-end:var(--row,_48px)] [&>.load-more]:my-[calc((var(--row,_48px)_-_32px)_/_2)]"
          }
          data-scroll-panel
          data-fade-start={edges.before || undefined}
          data-fade-end={edges.after || undefined}
          tabIndex={edges.before || edges.after ? 0 : undefined}
          aria-label={"Links in " + weekLabel(week)}
        >
          {/* A fixed snap point at the top. Otherwise the list snaps to its first row and holds on
              to it, so a new link added above would push the list down a row and back. */}
          <div className="link-list-start" />
          <QueryState
            pending={list.isPending}
            hasData={!!list.data}
            error={list.error}
            retry={() => void list.refetch()}
            placeholder={placeholder}
          >
            {links.map((link) => (
              <LinkRow
                key={link.id}
                link={link}
                owner={showOwners ? ownerOf(link) : undefined}
                locked={!!link.groupId && !!lockedGroups?.has(link.groupId)}
              />
            ))}
            {list.data?.pages[0]?.items.length === 0 && !add && (
              <p
                className={
                  "empty-state [&[role='alert']>p]:select-text text-muted-foreground p-[32px_12px] text-center [&_p]:mb-3.5 [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-[4px]"
                }
              >
                No links this week.
              </p>
            )}
            <div ref={end} className="link-list-end" />
            {isFetchingNextPage && (
              <p
                className={
                  "link-list-loading flex items-center min-h-[var(--row,_48px)] pl-[calc(var(--mark-column,_32px)_+_12px)] text-subtle-foreground text-[13px] [animation:loading-pulse_1.5s_ease-in-out_infinite]"
                }
              >
                Loading…
              </p>
            )}
            {isFetchNextPageError && (
              <More hasNext isFetching={isFetchingNextPage} fetch={fetchNextPage} />
            )}
          </QueryState>
        </div>
      </div>
    </>
  );
}
