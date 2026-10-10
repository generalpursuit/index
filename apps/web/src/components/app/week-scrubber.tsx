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
      className={
        "week-scrubber [--scrubber-bottom:24px] fixed top-[var(--scrubber-top)] left-[min(calc(50%_+_50px_+_370px_+_16px),_calc(100%_-_36px))] z-5 flex flex-col w-7 h-[min(_calc(100dvh_-_var(--scrubber-top)_-_var(--scrubber-bottom)),_calc(var(--weeks)_*_12px)_)] cursor-pointer touch-none select-none [@media(width<=700px)]:[--scrubber-bottom:calc(86px_+_env(safe-area-inset-bottom))] [@media(width<=700px)]:right-1 [@media(width<=700px)]:left-auto"
      }
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
          className={
            "week-tick relative flex-1 min-h-0.5 flex items-center justify-start [&::after]:[content:''] [&::after]:w-2.5 [&::after]:h-0.5 [&::after]:rounded-px [&::after]:bg-input [&::after]:[transition:width_120ms_ease,_background_120ms_ease] [&[data-hovered]::after]:w-4 [&[data-hovered]::after]:bg-subtle-foreground [&[data-active]::after]:w-5.5 [&[data-active]::after]:bg-foreground"
          }
          data-active={w.weekStart === active || undefined}
          data-hovered={index === hovered?.index || undefined}
        />
      ))}
      <div
        ref={label}
        className={
          "week-tick-label absolute left-9 flex [visibility:hidden] flex-col gap-0.5 p-[8px_12px] border border-border rounded-[12px] bg-card text-subtle-foreground text-[12px] text-left whitespace-nowrap [font-variant-numeric:tabular-nums] pointer-events-none [transform:translateY(-50%)] [&[data-visible]]:[visibility:visible] [&[data-inside]]:right-9 [&[data-inside]]:left-auto [&_strong]:font-serif [&_strong]:text-[16px] [&_strong]:font-bold [&_strong]:text-foreground"
        }
        data-visible={shown ? true : undefined}
        data-inside={hovered?.inside || undefined}
        style={{ top: `calc((${hovered?.index ?? 0} + 0.5) * 100% / ${weeks.length})` }}
      >
        <strong className={"size-stack grid [&>*]:[grid-area:1_/_1]"}>
          <span>{shown && weekLabel(shown.weekStart)}</span>
          <span className={"size-stack-ghost [visibility:hidden]"}>Week 53</span>
        </strong>
        <span className={"size-stack grid [&>*]:[grid-area:1_/_1]"}>
          <span>{shown && weekRange(shown.weekStart)}</span>
          {ranges.map((range) => (
            <span key={range} className={"size-stack-ghost [visibility:hidden]"}>
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
      <ul
        className={
          "week-picker flex flex-col max-h-[60vh] overflow-y-auto [&_button]:grid [&_button]:grid-cols-[auto_1fr_auto] [&_button]:[align-items:baseline] [&_button]:gap-3 [&_button]:w-full [&_button]:min-h-11 [&_button]:text-left [&_strong]:font-serif [&_strong]:text-[18px] [&_strong]:font-bold [&_span]:font-mono [&_span]:text-[11px] [&_span]:tracking-[0.06em] [&_span]:uppercase [&_span]:text-subtle-foreground [&_small]:text-[12px] [&_small]:text-subtle-foreground [&_button:hover_strong]:underline [&_button:hover_strong]:underline-offset-[4px]"
        }
      >
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
