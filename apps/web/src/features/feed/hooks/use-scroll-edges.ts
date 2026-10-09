import { useEffect, useState, type RefObject } from "react";

/** Whether a horizontal scroller hides content before or after its visible area. */
export function useScrollEdges(scroller: RefObject<HTMLElement | null>, itemCount: number) {
  const [edges, setEdges] = useState({ before: false, after: false });
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => {
      const before = element.scrollLeft > 1;
      const after = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      setEdges((old) => (old.before === before && old.after === after ? old : { before, after }));
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      resize.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [scroller, itemCount]);
  return edges;
}
