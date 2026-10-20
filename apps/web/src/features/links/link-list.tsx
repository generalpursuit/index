import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { More } from "@/components/app/query-state";
import { useScrollEdges } from "./hooks/use-scroll-edges";
import type { SavedLink } from "@/lib/types";

/** The pages of links an infinite query has loaded, and how to load the next one. */
type LinkPages = {
  data?: { pages: { items: SavedLink[] }[] };
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  fetchNextPage: () => Promise<unknown>;
};

export function scrollToTop(scroller: RefObject<HTMLElement | null>) {
  scroller.current?.scrollTo({ top: 0, behavior: "smooth" });
}

/**
 * Scrolls link rows within the height its parent gives it, without a scrollbar: it snaps to rows,
 * fades the edges it hides, brings new links at the top into view and loads the next page as its
 * end comes near. Rows are its direct children and set `--row`; it positions what is placed over
 * them.
 */
export function LinkList({
  list,
  label,
  scroller,
  children,
}: {
  list: LinkPages;
  label: string;
  /** The scrolling element, for bringing the top into view as a save starts. */
  scroller: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const links = list.data?.pages.flatMap((p) => p.items) ?? [];
  const edges = useScrollEdges(scroller, links.length, "y");
  // New links show up first, so bring the top into view when one arrives from elsewhere.
  const seen = useRef<Set<string>>(null);
  useEffect(() => {
    const first = links[0]?.id;
    if (seen.current && first && !seen.current.has(first)) scrollToTop(scroller);
    seen.current = new Set(links.map((link) => link.id));
  }, [list.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // The next page loads as the end of the list comes near; a failed load offers a retry instead.
  const end = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = list;
  useEffect(() => {
    const root = scroller.current,
      target = end.current;
    if (!root || !target || !hasNextPage || isFetchingNextPage || isFetchNextPageError) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry?.isIntersecting && void fetchNextPage(),
      { root, rootMargin: "0px 0px 100% 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [
    scroller,
    links.length,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  ]);
  return (
    <div
      ref={scroller}
      className={
        "link-list relative min-h-0 overflow-y-auto [scroll-snap-type:y_proximity] [&>*]:[scroll-snap-align:start] [&:is([data-fade-start],_[data-fade-end])]:[mask-image:linear-gradient(_to_bottom,_transparent,_#000_var(--fade-start,_0px),_#000_calc(100%_-_var(--fade-end,_0px)),_transparent_)] [&[data-fade-start]]:[--fade-start:var(--row,_48px)] [&[data-fade-end]]:[--fade-end:var(--row,_48px)] [&>.load-more]:my-[calc((var(--row,_48px)_-_32px)_/_2)]"
      }
      data-scroll-panel
      data-fade-start={edges.before || undefined}
      data-fade-end={edges.after || undefined}
      tabIndex={edges.before || edges.after ? 0 : undefined}
      aria-label={label}
    >
      {/* A fixed snap point at the top. Otherwise the list snaps to its first row and holds on
          to it, so a new link added above would push the list down a row and back. */}
      <div className="link-list-start" />
      {children}
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
    </div>
  );
}
