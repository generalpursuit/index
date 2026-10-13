import { useRouter } from "@tanstack/react-router";
import { useRef } from "react";
export function useBack(fallback = "/") {
  const router = useRouter();
  return () => {
    if (window.history.state?.__TSR_index > 0) router.history.back();
    else router.history.replace(fallback);
  };
}
/** Touches starting this close to the left edge belong to the back swipe. */
export const backSwipeEdge = 28;
export function useEdgeBack(back: () => void) {
  const origin = useRef<{ x: number; y: number } | null>(null);
  // Capturing sees touches that controls inside the page stop, such as long-press menus.
  return {
    onTouchStartCapture: (e: React.TouchEvent) => {
      const t = e.touches[0];
      origin.current = t && t.clientX < backSwipeEdge ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEndCapture: (e: React.TouchEvent) => {
      const t = e.changedTouches[0],
        start = origin.current;
      origin.current = null;
      if (start && t && t.clientX - start.x > 90 && Math.abs(t.clientY - start.y) < 45) back();
    },
  };
}
