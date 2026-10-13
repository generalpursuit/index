import { useRef, type MouseEvent, type PointerEvent } from "react";
import { backSwipeEdge } from "@/hooks/use-back";

/** How far the message must travel before letting go replies. */
const threshold = 56;
/** The message slows as it nears this distance, so it never leaves the finger far behind. */
const reach = 96;

type Gesture = { pointer: number; x: number; y: number; dragged: boolean; armed: boolean };

/**
 * Swiping a message right on a touch screen replies to it, as in iMessage: the message
 * follows the finger with resistance, uncovers a reply icon and springs back on release.
 */
export function useSwipeReply(reply: () => void) {
  const content = useRef<HTMLDivElement>(null),
    icon = useRef<HTMLSpanElement>(null),
    gesture = useRef<Gesture | null>(null),
    // A drag can end with a click on whatever is under the finger; it must not open a card.
    draggedAt = useRef(-Infinity);
  const show = (offset: number, settling: boolean) => {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (content.current) {
      content.current.style.transition = settling ? "transform 220ms cubic-bezier(.2,.8,.2,1)" : "";
      content.current.style.transform = still || !offset ? "" : `translateX(${offset}px)`;
    }
    if (icon.current) {
      icon.current.style.opacity = String(Math.min(1, offset / threshold));
      icon.current.dataset.armed = String(offset >= threshold);
    }
  };
  const release = (commit: boolean) => {
    const current = gesture.current;
    gesture.current = null;
    if (!current?.dragged) return;
    draggedAt.current = performance.now();
    show(0, true);
    if (commit && current.armed) reply();
  };
  return {
    content,
    icon,
    handlers: {
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        gesture.current =
          e.pointerType === "touch" && e.isPrimary && e.clientX >= backSwipeEdge
            ? { pointer: e.pointerId, x: e.clientX, y: e.clientY, dragged: false, armed: false }
            : null;
      },
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        const current = gesture.current;
        if (!current || e.pointerId !== current.pointer) return;
        const dx = e.clientX - current.x,
          dy = e.clientY - current.y;
        if (!current.dragged) {
          if (Math.abs(dx) <= 10 && Math.abs(dy) <= 10) return;
          // Vertical moves scroll and leftward ones are not replies.
          if (dx <= Math.abs(dy)) {
            gesture.current = null;
            return;
          }
          current.dragged = true;
        }
        const offset = reach * (1 - Math.exp(-Math.max(0, dx) / reach));
        current.armed = offset >= threshold;
        show(offset, false);
      },
      onPointerUp: () => release(true),
      onPointerCancel: () => release(false),
      onClickCapture: (e: MouseEvent<HTMLElement>) => {
        if (performance.now() - draggedAt.current > 400) return;
        e.preventDefault();
        e.stopPropagation();
      },
    },
  };
}
