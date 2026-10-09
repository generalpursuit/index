import { useEffect, type RefObject } from "react";

/**
 * Marks boxes that are mostly outside the carousel with `data-peeking`, so they can fade and
 * show there is more that way. Boxes in view never fade, whatever the window width.
 */
export function usePeeking(scroller: RefObject<HTMLElement | null>, itemCount: number) {
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          entry.target.toggleAttribute("data-peeking", entry.intersectionRatio < 0.9);
      },
      { root, threshold: 0.9 },
    );
    for (const box of root.children) observer.observe(box);
    return () => observer.disconnect();
  }, [scroller, itemCount]);
}
