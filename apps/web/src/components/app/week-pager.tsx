import type { ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useWeekPager, type WeekNeighbors } from "@/hooks/use-week-pager";
import { IconButton } from "./primitives";

/**
 * Weeks as pages: scroll (or use the arrows) to move to the next week with content, which
 * snaps into place before `go` puts it in the URL. Only the settled week is interactive.
 */
export function WeekPager({
  week,
  neighbors,
  go,
  label,
  children,
}: {
  week: string;
  neighbors?: WeekNeighbors;
  go: (week: string) => void;
  label: string;
  children: (week: string) => ReactNode;
}) {
  const { viewport, weeks, move } = useWeekPager(week, neighbors, go);
  return (
    <>
      {neighbors?.newerWeek && (
        <IconButton
          className="week-navigation week-navigation-newer"
          label="Newer week"
          onClick={() => move(1)}
        >
          <ChevronUp />
        </IconButton>
      )}
      <div ref={viewport} className="week-pager" role="region" aria-label={label}>
        {weeks.map((date) => (
          <section
            key={date}
            className="week-page"
            data-week={date}
            data-active={date === week}
            inert={date !== week}
            aria-hidden={date !== week}
          >
            {children(date)}
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
    </>
  );
}
