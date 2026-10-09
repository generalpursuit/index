import type { apiFor } from "@/utils/orpc";
export const activityOptions = (
  api: ReturnType<typeof apiFor>,
  type?: "comment" | "request" | "mention" | "follow",
) =>
  api.activity.list.infiniteOptions({
    input: (cursor: string | undefined) => ({ type, cursor, limit: 30 }),
    initialPageParam: undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    refetchInterval: 30_000,
  });
