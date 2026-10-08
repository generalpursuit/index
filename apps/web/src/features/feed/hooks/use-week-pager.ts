import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { monday, shiftWeek } from "@/lib/weeks";

/** Keep one settled week in the URL while the browser handles scrolling and snap physics. */
export function useWeekPager(week: string) {
  const viewport = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const committing = useRef<string | null>(null);
  const weeks = useMemo(
    () =>
      [shiftWeek(week, 1), week, shiftWeek(week, -1)].filter(
        (date) => date <= monday() && date >= "0001-01-01",
      ),
    [week],
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
      void navigate({ to: "/", search: { week: next }, replace: true, resetScroll: false });
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
  }, [week, weeks, navigate]);

  const move = useCallback(
    (direction: number) => {
      const element = viewport.current;
      const index = weeks.indexOf(shiftWeek(week, direction));
      if (!element || index < 0) return;
      element.scrollTo({
        top: index * element.clientHeight,
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      });
    },
    [week, weeks],
  );

  return { viewport, weeks, move };
}
