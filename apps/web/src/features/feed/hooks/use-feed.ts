import { useEffect } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useAPI } from "@/hooks/use-api";
import { monday } from "@/lib/weeks";
export function useFeed(weekStart: string) {
  const api = useAPI();
  return useInfiniteQuery(
    api.feed.week.infiniteOptions({
      input: (after: string | undefined) => ({ weekStart, after, limit: 10, linkLimit: 20 }),
      initialPageParam: undefined,
      getNextPageParam: (p) => p.nextAfter ?? undefined,
    }),
  );
}
/**
 * Every week with links from you or people you follow, newest first, with the current week
 * always included (it offers the field). The list is small, so all of it loads.
 */
export function useFeedWeeks() {
  const api = useAPI();
  const list = useInfiniteQuery(
    api.feed.weeks.infiniteOptions({
      input: (before: string | undefined) => ({ before, limit: 100 }),
      initialPageParam: undefined,
      getNextPageParam: (p) => p.nextBefore ?? undefined,
    }),
  );
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const loaded = list.data?.pages.flatMap((p) => p.items) ?? [];
  return loaded[0]?.weekStart === monday()
    ? loaded
    : [{ weekStart: monday(), count: 0 }, ...loaded];
}
