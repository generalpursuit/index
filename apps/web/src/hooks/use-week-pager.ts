import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

export type WeekNeighbors = { newerWeek: string | null; olderWeek: string | null };
/**
 * Keep the pager on the URL's week while the browser animates slides to a neighbor.
 * Neighbors come from the page (they skip empty weeks); `go` puts a week in the URL once a
 * slide toward it settles. Only those slides choose a week: any other scroll, such as the
 * router restoring an offset on Back, resizing or centering, returns to the URL's week.
 */
export function useWeekPager(
  week: string,
  neighbors: WeekNeighbors | undefined,
  go: (week: string) => void,
) {
  const viewport = useRef<HTMLDivElement>(null);
  // The neighbor a slide is heading to, and whether it has reached it and asked for its URL.
  const slide = useRef<{ week: string; arrived: boolean } | null>(null);
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
    slide.current = null;
    const center = () =>
      element.scrollTo({ top: weeks.indexOf(week) * element.clientHeight, behavior: "instant" });
    center();
    const resize = new ResizeObserver(center);
    resize.observe(element);
    let timer: ReturnType<typeof setTimeout>;
    const at = (date: string) =>
      Math.abs(element.scrollTop - weeks.indexOf(date) * element.clientHeight) <= 2;
    // A slide that rests on its week puts it in the URL; one stopped elsewhere is over.
    const settle = () => {
      const current = slide.current;
      if (!current || current.arrived) return;
      if (at(current.week)) {
        current.arrived = true;
        goTo.current(current.week);
      } else {
        slide.current = null;
        center();
      }
    };
    const scrolled = (event: Event) => {
      if (event.target !== element) return;
      if (!slide.current && !at(week)) center();
      if (!("onscrollend" in document.documentElement)) {
        // Older WebViews have CSS snapping but no scrollend event.
        clearTimeout(timer);
        timer = setTimeout(settle, 220);
      }
    };
    const finished = (event: Event) => {
      if (event.target === element) settle();
    };
    element.addEventListener("scroll", scrolled);
    element.addEventListener("scrollend", finished);
    return () => {
      resize.disconnect();
      clearTimeout(timer);
      element.removeEventListener("scroll", scrolled);
      element.removeEventListener("scrollend", finished);
    };
  }, [week, weeks]);

  // `instant` skips the slide, so 0 can also stop one still under way.
  const move = useCallback(
    (direction: number, instant = false) => {
      const element = viewport.current;
      // Newer weeks sit above the current one, so moving forward means a lower index.
      const index = weeks.indexOf(week) - direction;
      if (!element || index < 0 || index >= weeks.length) return;
      slide.current = direction ? { week: weeks[index]!, arrived: false } : null;
      element.scrollTo({
        top: index * element.clientHeight,
        behavior:
          instant || matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      });
    },
    [week, weeks],
  );

  return { viewport, weeks, move };
}
