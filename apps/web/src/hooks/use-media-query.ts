import { useSyncExternalStore } from "react";

/** Whether a CSS media query currently matches, updating as the viewport changes. */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (notify) => {
      const list = matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}
