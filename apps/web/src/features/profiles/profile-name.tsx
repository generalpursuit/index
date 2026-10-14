import { useLayoutEffect, useRef } from "react";

/** Keep the complete name on one line, shrinking only when the available width needs it. */
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
      if (natural > element.clientWidth)
        element.style.fontSize = `${(size * element.clientWidth) / natural}px`;
    };
    fit();
    let frame = 0;
    const scheduleFit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    // Observe width rather than height: fitting the type changes the heading's height.
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth !== width) {
        width = element.clientWidth;
        scheduleFit();
      }
    });
    observer.observe(element);
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
    <h1 ref={heading} className="flex-1 whitespace-nowrap">
      <span className="inline-block">{name}</span>
    </h1>
  );
}
