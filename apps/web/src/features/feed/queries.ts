import type { apiFor } from "@/utils/orpc";
type API = ReturnType<typeof apiFor>;
export const feedWeekOptions = (api: API, weekStart: string) =>
  api.feed.week.infiniteOptions({
    input: (after: string | undefined) => ({ weekStart, after, limit: 10, linkLimit: 20 }),
    initialPageParam: undefined,
    getNextPageParam: (p) => p.nextAfter ?? undefined,
  });
export const feedWeeksOptions = (api: API) =>
  api.feed.weeks.infiniteOptions({
    input: (before: string | undefined) => ({ before, limit: 100 }),
    initialPageParam: undefined,
    getNextPageParam: (p) => p.nextBefore ?? undefined,
  });
