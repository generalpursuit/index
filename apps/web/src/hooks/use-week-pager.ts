import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

export type WeekNeighbors = { newerWeek: string | null; olderWeek: string | null };
/**
 * Keep one settled week in the URL while the browser handles scrolling and snap physics.
 * Neighbors come from the page (they skip empty weeks); `go` puts a settled week in the URL.
 */
export function useWeekPager(
  week: string,
  neighbors: WeekNeighbors | undefined,
  go: (week: string) => void,
) {
  const viewport = useRef<HTMLDivElement>(null);
  const committing = useRef<string | null>(null);
  const goTo = useRef(go);
  goTo.current = go;
  const newer = neighbors?.newerWeek,
    older = neighbors?.olderWeek;
  const weeks = useMemo(
    () => [newer, week, older].filter((date): date is string => !!date),
    [newer, week, older],
  );

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    committing.current = null;
    const center = () =>
      element.scrollTo({ top: weeks.indexOf(week) * element.clientHeight, behavior: "instant" });
    center();
    const resize = new ResizeObserver(center);
    resize.observe(element);
    return () => resize.disconnect();
  }, [week, weeks]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout>;
    const settle = () => {
      const index = Math.round(element.scrollTop / element.clientHeight);
      const next = weeks[index];
      // Ignore inner-list scrolls and a gesture that has not reached a snap point yet.
      if (
        !next ||
        next === week ||
        committing.current ||
        Math.abs(element.scrollTop - index * element.clientHeight) > 2
      )
        return;
      committing.current = next;
      goTo.current(next);
    };
    const finished = (event: Event) => {
      if (event.target === element) settle();
    };
    const fallback = () => {
      clearTimeout(timer);
      timer = setTimeout(settle, 220);
    };
    element.addEventListener("scrollend", finished);
    // Older WebViews have CSS snapping but no scrollend event.
    if (!("onscrollend" in document.documentElement)) element.addEventListener("scroll", fallback);
    return () => {
      clearTimeout(timer);
      element.removeEventListener("scrollend", finished);
      element.removeEventListener("scroll", fallback);
    };
  }, [week, weeks]);

  const move = useCallback(
    (direction: number) => {
      const element = viewport.current;
      // Newer weeks sit above the current one, so moving forward means a lower index.
      const index = weeks.indexOf(week) - direction;
      if (!element || index < 0 || index >= weeks.length) return;
      element.scrollTo({
        top: index * element.clientHeight,
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      });
    },
    [week, weeks],
  );

  return { viewport, weeks, move };
}
