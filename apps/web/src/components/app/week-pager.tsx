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
  const { viewport, weeks: pages, move } = useWeekPager(week, neighbors, go);
  const jump = (target: string) => {
    if (target === week) return;
    if (target === neighbors?.newerWeek) move(1);
    else if (target === neighbors?.olderWeek) move(-1);
    else go(target);
  };
  return (
    <>
      <div
        ref={viewport}
        className={
          "week-pager relative h-full overflow-y-hidden overscroll-y-contain [scroll-snap-type:y_mandatory] [overflow-anchor:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
