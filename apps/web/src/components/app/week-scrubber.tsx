import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type RefObject,
} from "react";
import { weekLabel, weekRange } from "@/lib/weeks";
import { Modal } from "./primitives";

export type Week = { weekStart: string; count: number };

/**
 * A strip along the right edge with one tick per week, the week in view drawn longer. With a
 * mouse, hovering names a week and clicking jumps there; on touch, pressing names the week under
 * the finger, sliding moves through weeks and letting go jumps. It is a pointer shortcut: the
 * week title opens the same choice as a list (`WeekPicker`) for keyboards and screen readers.
 */
export function WeekScrubber({
  weeks,
  active,
  onJump,
  anchor,
  offset = 0,
}: {
  weeks: Week[];
  active?: string;
  onJump: (week: string) => void;
  /** The list the strip lines up with: its first tick sits `offset` below the list's top. */
  anchor: RefObject<HTMLElement | null>;
  offset?: number;
}) {
  const top = useListTop(anchor, offset);
  const [hovered, setHovered] = useState<{ index: number; inside: boolean } | null>(null);
  const pressed = useRef(false);
  // The week the label names; letting go lands exactly there.
  const named = useRef(0);
  const label = useRef<HTMLDivElement>(null);
  // Every range this list can show, stacked unseen under the label, so it keeps one size.
  const ranges = useMemo(() => [...new Set(weeks.map((w) => weekRange(w.weekStart)))], [weeks]);
  if (weeks.length < 2) return null;
  const at = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.floor(((event.clientY - box.top) / box.height) * weeks.length);
    // The label opens into the gutter when it fits, otherwise over the end of the rows.
    const room = innerWidth - box.right - 16;
    return {
      index: Math.min(weeks.length - 1, Math.max(0, index)),
      inside: (label.current?.offsetWidth ?? 0) + 8 > room,
    };
  };
  const name = (spot: { index: number; inside: boolean }) => {
    named.current = spot.index;
    setHovered(spot);
  };
  const shown = hovered && weeks[hovered.index];
  return (
    <div
      className="week-scrubber"
      aria-hidden="true"
      style={{ "--weeks": weeks.length, "--scrubber-top": top + "px" } as CSSProperties}
      onPointerDown={(e) => {
        pressed.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        name(at(e));
      }}
      onPointerMove={(e) => {
        if (e.pointerType === "mouse" || pressed.current) name(at(e));
      }}
      onPointerUp={(e) => {
        if (!pressed.current) return;
        pressed.current = false;
        onJump(weeks[named.current]!.weekStart);
        if (e.pointerType !== "mouse") setHovered(null);
      }}
      onPointerCancel={() => {
        pressed.current = false;
        setHovered(null);
      }}
      onPointerLeave={() => {
        if (!pressed.current) setHovered(null);
      }}
    >
      {weeks.map((w, index) => (
        <span
          key={w.weekStart}
          className="week-tick"
          data-active={w.weekStart === active || undefined}
          data-hovered={index === hovered?.index || undefined}
        />
      ))}
      <div
        ref={label}
        className="week-tick-label"
        data-visible={shown ? true : undefined}
        data-inside={hovered?.inside || undefined}
        style={{ top: `calc((${hovered?.index ?? 0} + 0.5) * 100% / ${weeks.length})` }}
      >
        <strong className="size-stack">
          <span>{shown && weekLabel(shown.weekStart)}</span>
          <span className="size-stack-ghost">Week 53</span>
        </strong>
        <span className="size-stack">
          <span>{shown && weekRange(shown.weekStart)}</span>
          {ranges.map((range) => (
            <span key={range} className="size-stack-ghost">
              {range}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

/**
 * Where the strip starts: level with the top of the list, and once the list scrolls up, level
 * with the top of the page (plus `offset`, e.g. a sticky heading the rows pass under).
 */
function useListTop(anchor: RefObject<HTMLElement | null>, offset: number) {
  const [top, setTop] = useState(0);
  useEffect(() => {
    const scroller = document.getElementById("app-scroll"),
      element = anchor.current;
    if (!scroller || !element) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const page = scroller.getBoundingClientRect().top;
        setTop(Math.round(Math.max(page, element.getBoundingClientRect().top) + offset));
      });
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(scroller);
    resize.observe(element);
    scroller.addEventListener("scroll", measure, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      scroller.removeEventListener("scroll", measure);
    };
  }, [anchor, offset]);
  return top;
}

/** Every week as a list with its link count, for jumping without the scrubber. */
export function WeekPicker({
  open,
  onOpenChange,
  weeks,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  weeks: Week[];
  onPick: (week: string) => void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Weeks">
      <ul className="week-picker">
        {weeks.map((w) => (
          <li key={w.weekStart}>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                // After the sheet lets go of the page.
                requestAnimationFrame(() => onPick(w.weekStart));
              }}
            >
              <strong>{weekLabel(w.weekStart)}</strong>
              <span>{weekRange(w.weekStart)}</span>
              <small>{w.count === 1 ? "1 link" : w.count + " links"}</small>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
