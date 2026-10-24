import { useLayoutEffect, useRef } from "react";

/**
 * Keep the complete name on one line, shrinking only when the available width needs it. The
 * heading is only as wide as the name, so what follows in its row (the visibility mark) sits
 * beside the name; the row's width is the space the name may take.
 */
export function ProfileName({ name }: { name: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    const element = heading.current;
    const text = element?.firstElementChild as HTMLElement | null;
    if (!element || !text) return;
    const fit = () => {
      element.style.removeProperty("font-size");
      const size = parseFloat(getComputedStyle(element).fontSize);
      const natural = text.getBoundingClientRect().width;
      // Exact widths: clientWidth rounds to whole pixels, so a heading as wide as its name
      // could seem a fraction too narrow and shrink a name that fits.
      const available = element.getBoundingClientRect().width;
      if (natural > available) element.style.fontSize = `${(size * available) / natural}px`;
    };
    fit();
    let frame = 0;
    const scheduleFit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    // Observe the row's width rather than the heading's: a shrunken name keeps its heading
    // narrow, so only the row shows that there is room again.
    const row = element.parentElement!;
    let width = row.clientWidth;
    const observer = new ResizeObserver(() => {
      if (row.clientWidth !== width) {
        width = row.clientWidth;
        scheduleFit();
      }
    });
    observer.observe(row);
    window.addEventListener("resize", scheduleFit);
    document.fonts.addEventListener("loadingdone", scheduleFit);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleFit);
      document.fonts.removeEventListener("loadingdone", scheduleFit);
    };
  }, [name]);
  return (
    <h1 ref={heading} className="whitespace-nowrap">
      <span className="inline-block">{name}</span>
    </h1>
  );
}
