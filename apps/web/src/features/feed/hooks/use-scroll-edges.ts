import { useEffect, useState, type RefObject } from "react";

/** Whether a scroller hides content before or after its visible area along one axis. */
export function useScrollEdges(
  scroller: RefObject<HTMLElement | null>,
  itemCount: number,
  axis: "x" | "y" = "x",
) {
  const [edges, setEdges] = useState({ before: false, after: false });
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => {
      const [position, visible, total] =
        axis === "x"
          ? [element.scrollLeft, element.clientWidth, element.scrollWidth]
          : [element.scrollTop, element.clientHeight, element.scrollHeight];
      const before = position > 1;
      const after = position + visible < total - 1;
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
  }, [scroller, itemCount, axis]);
  return edges;
}
