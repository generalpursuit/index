import { useRouter } from "@tanstack/react-router";
import { useRef } from "react";
export function useBack(fallback = "/") {
  const router = useRouter();
  return () => {
    if (window.history.state?.__TSR_index > 0) router.history.back();
    else router.history.replace(fallback);
  };
}
export function useEdgeBack(back: () => void) {
  const origin = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      origin.current = t && t.clientX < 28 ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const t = e.changedTouches[0],
        start = origin.current;
      origin.current = null;
      if (start && t && t.clientX - start.x > 90 && Math.abs(t.clientY - start.y) < 45) back();
    },
  };
}
