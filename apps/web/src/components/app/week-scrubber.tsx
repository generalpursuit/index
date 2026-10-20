import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { desktopHaptic } from "@/lib/desktop";
import { weekLabel, weekNumber, weekRange, yearMarks } from "@/lib/weeks";
import { Modal } from "@index/ui/components/modal";

export type Week = { weekStart: string; count: number };

// Holding still this long opens the focus ring; moving farther than DRAG_PX first makes a drag.
const HOLD_MS = 350;
const DRAG_PX = 6;
// In the focus ring each week is a row this tall (its `h-6`), and the pointer moves one row per
// week.
const ROW_PX = 24;
// Ticks within this distance of the cursor surface.
const SURFACE_PX = 44;

type Spot = { index: number; inside: boolean; fresh: boolean; roll?: "older" | "newer" };

/**
 * A strip along the right edge with one tick per week, read like a ruler: length shows the unit
 * and ink the state. Weeks are short and light, the weeks on screen dark at a middle length, and
 * the first week of a year long. Weeks near the cursor surface. Hovering names a week. Pressing
 * goes there, and dragging scrubs through the weeks with the page following. Holding still opens
 * a focus ring that spreads out the nearby weeks, so a drag then moves one week at a time. It is
 * a pointer shortcut: the week title opens the same choice as a list (`WeekPicker`) for keyboards
 * and screen readers.
 */
export function WeekScrubber({
  weeks,
  active,
  onJump,
}: {
  weeks: Week[];
  active: readonly string[];
  /** `scrubbing` is set for the weeks a drag passes through, which should land at once. */
  onJump: (week: string, scrubbing: boolean) => void;
}) {
  const [spot, setSpot] = useState<Spot | null>(null);
  // The open focus ring: its center on the rail, and the week there (fractional mid-drag).
  const [ring, setRing] = useState<{ top: number; at: number } | null>(null);
  const [pitch, setPitch] = useState(12);
  const rail = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLDivElement>(null);
  // The current press: where it started, its pending hold, and the ring's anchor once open.
  const press = useRef<{ y: number; hold: number; anchor?: { y: number; index: number } }>(null);
  // The named week, for events to compare against before the next render.
  const named = useRef<number | null>(null);
  const years = useMemo(() => yearMarks(weeks.map((w) => w.weekStart)), [weeks]);
  // Every range this list can show, stacked unseen under the label, so it keeps one size.
  const ranges = useMemo(() => [...new Set(weeks.map((w) => weekRange(w.weekStart)))], [weeks]);
  const count = weeks.length;
  useLayoutEffect(() => {
    const element = rail.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setPitch(element.clientHeight / count));
    observer.observe(element);
    return () => observer.disconnect();
  }, [count]);
  useEffect(() => () => clearTimeout(press.current?.hold), []);
  if (count < 2) return null;

  const measure = (y: number) => {
    const box = rail.current!.getBoundingClientRect();
    const at = ((y - box.top) / box.height) * count;
    return {
      // The cursor in ticks, 0 at the first tick's middle; ticks surface by their distance to it.
      at: at - 0.5,
      index: Math.min(count - 1, Math.max(0, Math.floor(at))),
      // The label opens into the gutter when it fits, otherwise over the end of the rows.
      inside: (label.current?.offsetWidth ?? 0) + 8 > innerWidth - box.right - 16,
    };
  };
  const follow = (at: number) => rail.current?.style.setProperty("--at", String(at));
  /** Names a week in the label; true when that is another week. */
  const name = (index: number, inside: boolean) => {
    const previous = named.current;
    named.current = index;
    setSpot((spot) => {
      if (spot?.index === index) return spot.inside === inside ? spot : { ...spot, inside };
      const roll = spot && (index > spot.index ? "older" : "newer");
      return { index, inside, fresh: !spot, roll: roll || undefined };
    });
    return previous !== index;
  };
  const go = (index: number, scrubbing: boolean) => {
    onJump(weeks[index]!.weekStart, scrubbing);
    desktopHaptic(years[index] ? "boundary" : "step");
  };
  const hide = () => {
    named.current = null;
    setSpot(null);
    rail.current?.style.removeProperty("--at");
  };
  const release = () => {
    if (!press.current) return;
    clearTimeout(press.current.hold);
    press.current = null;
    setRing(null);
  };
  const hold = (y: number) => {
    const current = press.current,
      index = named.current,
      box = rail.current?.getBoundingClientRect();
    if (!current || index === null || !box) return;
    current.anchor = { y, index };
    setRing({ top: y - box.top, at: index });
    desktopHaptic("boundary");
  };
  const shown = spot && weeks[spot.index];
  return (
    <div
      ref={rail}
      className={
        // Centered on the screen like the navigation rail, above the bar along a phone's foot.
        "week-scrubber [--bottom-bar:0px] fixed top-[calc((100dvh_+_var(--titlebar-inset)_-_var(--bottom-bar))_/_2)] left-[min(calc(50%_+_50px_+_370px_+_16px),_calc(100%_-_36px))] z-5 flex flex-col w-7 h-[min(60dvh,_calc(var(--weeks)_*_12px))] -translate-y-1/2 cursor-pointer touch-none select-none [-webkit-touch-callout:none] [--at:-1000] [@media(width<=700px)]:[--bottom-bar:calc(66px_+_env(safe-area-inset-bottom))] [@media(width<=700px)]:right-1 [@media(width<=700px)]:left-auto"
      }
      aria-hidden="true"
      style={{ "--weeks": count, "--reach": Math.max(2.5, SURFACE_PX / pitch) } as CSSProperties}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const y = e.clientY,
          next = measure(y);
        clearTimeout(press.current?.hold);
        press.current = { y, hold: window.setTimeout(() => hold(y), HOLD_MS) };
        follow(next.at);
        name(next.index, next.inside);
        go(next.index, false);
      }}
      onPointerMove={(e) => {
        const current = press.current;
        if (current?.anchor) {
          const { anchor } = current;
          const at = Math.min(
            count - 1,
            Math.max(0, anchor.index + (e.clientY - anchor.y) / ROW_PX),
          );
          setRing((ring) => ring && { ...ring, at });
          if (name(Math.round(at), spot?.inside ?? false)) go(Math.round(at), true);
          return;
        }
        if (!current && e.pointerType !== "mouse") return;
        const next = measure(e.clientY);
        follow(next.at);
        if (name(next.index, next.inside) && current) go(next.index, true);
        if (current && Math.abs(e.clientY - current.y) > DRAG_PX) clearTimeout(current.hold);
      }}
      onPointerUp={(e) => {
        release();
        if (e.pointerType !== "mouse") hide();
      }}
      onPointerCancel={() => {
        release();
        hide();
      }}
      onPointerLeave={() => {
        if (!press.current) hide();
      }}
      // A long press would otherwise open the context menu on touch screens.
      onContextMenu={(e) => e.preventDefault()}
    >
      {weeks.map((w, index) => (
        <span
          key={w.weekStart}
          className={
            // --w and --o are the tick's length and ink at rest. A week on screen that starts a
            // year keeps the year's length. --f is how near the cursor is, from 1 on the tick to 0
            // at --reach ticks away; it darkens ticks and grows plain weeks up to the middle length.
            "week-tick flex-1 min-h-0 flex items-center justify-center [--w:8px] [--o:0.32] [&[data-active]:not([data-year])]:[--w:16px] [&[data-year]]:[--w:24px] [&[data-active]]:[--o:1] [&[data-year]:not([data-active])]:[--o:0.5] [--f:max(0,_1_-_max(var(--i)_-_var(--at),_var(--at)_-_var(--i))_/_var(--reach))] [&::after]:[content:''] [&::after]:h-0.5 [&::after]:rounded-full [&::after]:bg-foreground [&::after]:w-[min(max(var(--w),_16px),_calc(var(--w)_+_8px_*_var(--f)_*_var(--f)))] [&::after]:opacity-[calc(var(--o)_+_(1_-_var(--o))_*_var(--f)_*_var(--f))] [&::after]:[transition:width_140ms_ease,_opacity_140ms_ease] [&[data-hovered]::after]:opacity-100 [&[data-active]::after]:h-[3px]"
          }
          style={{ "--i": index } as CSSProperties}
          data-year={years[index] ? true : undefined}
          data-active={active.includes(w.weekStart) || undefined}
          data-hovered={index === spot?.index || undefined}
        />
      ))}
      {ring && <FocusRing weeks={weeks} years={years} {...ring} />}
      <div
        ref={label}
        className={
          "week-tick-label absolute left-9 flex [visibility:hidden] flex-col gap-0.5 p-[8px_12px] border border-border rounded-[12px] bg-card text-subtle-foreground text-[12px] text-left whitespace-nowrap [font-variant-numeric:tabular-nums] pointer-events-none [transform:translateY(-50%)] [transition:top_90ms_ease-out,_right_160ms_ease-out] [&[data-fresh]]:[transition:none] motion-reduce:[transition:none] [&[data-visible]]:[visibility:visible] [&[data-inside]]:right-9 [&[data-inside]]:left-auto [&[data-inside][data-focus]]:right-15 [&_strong]:font-serif [&_strong]:text-[16px] [&_strong]:font-bold [&_strong]:text-foreground"
        }
        data-visible={shown ? true : undefined}
        data-inside={spot?.inside || undefined}
        data-fresh={spot?.fresh || undefined}
        data-focus={ring ? true : undefined}
        style={{
          top: ring ? ring.top : `calc((${spot?.index ?? 0} + 0.5) * 100% / ${count})`,
        }}
      >
        <strong className={"size-stack grid overflow-hidden [&>*]:[grid-area:1_/_1]"}>
          <span>
            {shown && (
              <>
                {"Week "}
                {/* A new key per week replays the roll. */}
                <span
                  key={shown.weekStart}
                  className={
                    "inline-block [&[data-roll=older]]:[animation:week-roll-older_160ms_ease-out] [&[data-roll=newer]]:[animation:week-roll-newer_160ms_ease-out] motion-reduce:[animation:none]"
                  }
                  data-roll={spot.roll}
                >
                  {weekNumber(shown.weekStart)}
                </span>
              </>
            )}
          </span>
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
 * The weeks around a held one, a row each, sliding past the selection marks as a drag moves
 * through them. A row that starts a year shows the year in place of its number, unless selected.
 */
function FocusRing({
  weeks,
  years,
  top,
  at,
}: {
  weeks: Week[];
  years: readonly (string | null)[];
  top: number;
  at: number;
}) {
  const center = Math.round(at);
  const rows = [];
  for (let i = Math.max(0, center - 6); i <= Math.min(weeks.length - 1, center + 6); i++)
    rows.push(i);
  return (
    <div
      className={
        "week-focus absolute right-0 w-13 h-66 -translate-y-1/2 bg-background pointer-events-none [mask-image:linear-gradient(transparent,_#000_30%,_#000_70%,_transparent)] [animation:week-focus-in_160ms_ease-out] motion-reduce:[animation:none]"
      }
      style={{ top }}
    >
      {rows.map((index) => {
        const year = index === center ? null : years[index];
        return (
          <span
            key={weeks[index]!.weekStart}
            className={
              "absolute inset-x-0 top-1/2 -mt-3 h-6 flex items-center justify-center font-mono text-[13px] tabular-nums text-foreground [&[data-center]]:font-bold [&[data-year]]:text-[11px] [&[data-year]]:text-subtle-foreground"
            }
            data-center={index === center || undefined}
            data-year={year ? true : undefined}
            style={{
              transform: `translateY(${(index - at) * ROW_PX}px)`,
              opacity: Math.max(0, 1 - Math.abs(index - at) / 5.5),
            }}
          >
            {year ?? weekNumber(weeks[index]!.weekStart)}
          </span>
        );
      })}
      <span
        className={"absolute top-1/2 left-0 w-2 h-[3px] -mt-[1.5px] rounded-full bg-foreground"}
      />
      <span
        className={"absolute top-1/2 right-0 w-2 h-[3px] -mt-[1.5px] rounded-full bg-foreground"}
      />
    </div>
  );
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
    <Modal open={open} onOpenChange={onOpenChange} title="Weeks" fixedHeight>
      <ul
        className={
          "week-picker flex flex-col [&_button]:grid [&_button]:grid-cols-[auto_1fr_auto] [&_button]:[align-items:baseline] [&_button]:gap-3 [&_button]:w-full [&_button]:min-h-12 [&_button]:text-left [&_strong]:font-serif [&_strong]:text-[18px] [&_strong]:font-bold [&_span]:font-mono [&_span]:text-[11px] [&_span]:tracking-[0.06em] [&_span]:uppercase [&_span]:text-subtle-foreground [&_small]:text-[12px] [&_small]:text-subtle-foreground [&_button:hover_strong]:underline [&_button:hover_strong]:underline-offset-[4px]"
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
