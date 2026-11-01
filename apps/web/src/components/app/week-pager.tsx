import type { ReactNode } from "react";
import { useWeekPager, type WeekNeighbors } from "@/hooks/use-week-pager";
import { WeekScrubber, type Week } from "./week-scrubber";

/**
 * Weeks as pages that change only on purpose: the scrubber (or the week list behind the
 * title) picks a week, so reaching the end of a list never moves you to another week. A
 * neighboring week slides into place before `go` puts it in the URL; farther weeks open
 * directly. Only the settled week is interactive.
 */
export function WeekPager({
  week,
  weeks,
  neighbors,
  go,
  label,
  children,
}: {
  week: string;
  weeks: Week[];
  neighbors?: WeekNeighbors;
  go: (week: string) => void;
  label: string;
  children: (week: string) => ReactNode;
}) {
  // Until the week's own page names its neighbors, the week list does, so the week just left
  // stays mounted beside a chosen one that is still loading, and keeps its drafts and scroll.
  const around = neighbors ?? listNeighbors(weeks, week);
  const { viewport, weeks: pages, move } = useWeekPager(week, around, go);
  // A pressed neighbor slides into place. While scrubbing every week lands at once, and
  // returning to this one stops a slide still under way.
  const jump = (target: string, scrubbing: boolean) => {
    if (target === week) {
      if (scrubbing) move(0, true);
    } else if (scrubbing) go(target);
    else if (target === around?.newerWeek) move(1);
    else if (target === around?.olderWeek) move(-1);
    else go(target);
  };
  return (
    <>
      <div
        ref={viewport}
        className={
          "week-pager relative h-full overflow-y-hidden overscroll-y-contain [scroll-snap-type:y_mandatory] [overflow-anchor:none]"
        }
        role="region"
        aria-label={label}
      >
        {pages.map((date) => (
          <section
            key={date}
            className={
              "week-page h-full pb-10 [scroll-snap-align:start] [scroll-snap-stop:always] [@media(width<=700px)]:pb-10 [@media(width<=700px)_and_(height<=740px)]:pb-9"
            }
            data-week={date}
            data-active={date === week}
            inert={date !== week}
            aria-hidden={date !== week}
          >
            {children(date)}
          </section>
        ))}
      </div>
      <WeekScrubber weeks={weeks} active={[week]} onJump={jump} />
    </>
  );
}

/** The weeks beside `week` in the newest-first list, or nothing when the list lacks it. */
function listNeighbors(weeks: Week[], week: string): WeekNeighbors | undefined {
  const index = weeks.findIndex((w) => w.weekStart === week);
  if (index < 0) return undefined;
  return {
    newerWeek: weeks[index - 1]?.weekStart ?? null,
    olderWeek: weeks[index + 1]?.weekStart ?? null,
  };
}
