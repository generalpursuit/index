import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { connectionsOptions } from "@/features/profiles/queries";
import { apiFor } from "@/utils/orpc";
import { canPrefetch } from "@/data/client";

const whenIdle = (task: () => void) =>
  "requestIdleCallback" in window
    ? window.cancelIdleCallback.bind(window, window.requestIdleCallback(task, { timeout: 2000 }))
    : clearTimeout.bind(window, setTimeout(task, 300));

/**
 * Once the first page has loaded, load the other main pages and the lists behind their buttons,
 * so moving around the app finds them ready. Hovering covers everything else.
 */
export function useWarmUp(viewer: { id: string; username?: string | null } | null) {
  const router = useRouter(),
    cache = useQueryClient();
  const id = viewer?.id,
    username = viewer?.username;
  useEffect(() => {
    if (!id || !username || !canPrefetch()) return;
    const warm = () => {
      for (const to of ["/", "/discover", "/activity", "/messages", "/settings"] as const)
        void router.preloadRoute({ to }).catch(() => {});
      void router
        .preloadRoute({ to: "/u/$username", params: { username }, state: { userId: id } })
        .catch(() => {});
      for (const kind of ["followers", "following"] as const)
        void cache.prefetchInfiniteQuery(connectionsOptions(apiFor(id), id, kind));
    };
    let cancel: (() => void) | undefined;
    const schedule = () => {
      cancel ??= whenIdle(warm);
    };
    const unsubscribe = router.subscribe("onResolved", schedule);
    if (router.state.status === "idle") schedule();
    return () => {
      unsubscribe();
      cancel?.();
    };
  }, [id, username, router, cache]);
}
