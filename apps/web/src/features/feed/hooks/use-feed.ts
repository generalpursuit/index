import { useEffect } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useAPI } from "@/hooks/use-api";
import { monday } from "@/lib/weeks";
import { feedWeekOptions, feedWeeksOptions } from "../queries";
export function useFeed(weekStart: string) {
  return useInfiniteQuery(feedWeekOptions(useAPI(), weekStart));
}
/**
 * Every week with links from you or people you follow, newest first, with the current week
 * always included (it offers the field). The list is small, so all of it loads.
 */
export function useFeedWeeks() {
  const list = useInfiniteQuery(feedWeeksOptions(useAPI()));
  const { hasNextPage, isFetching, fetchNextPage } = list;
  useEffect(() => {
    if (hasNextPage && !isFetching && !list.isError) void fetchNextPage();
  }, [hasNextPage, isFetching, list.isError, fetchNextPage]);
  const loaded = list.data?.pages.flatMap((p) => p.items) ?? [];
  const weeks =
    loaded[0]?.weekStart === monday() ? loaded : [{ weekStart: monday(), count: 0 }, ...loaded];
  return { ...list, weeks };
}
