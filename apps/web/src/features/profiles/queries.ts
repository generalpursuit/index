import type { apiFor } from "@/utils/orpc";
type API = ReturnType<typeof apiFor>;
export const profileOptions = (api: API, userId: string) =>
  api.profiles.get.queryOptions({ input: { userId } });
/** Connections and the recipient picker share one list when nothing is searched. */
export const connectionsOptions = (
  api: API,
  userId: string,
  kind: "followers" | "following",
  query?: string,
) =>
  api.follows[kind].infiniteOptions({
    input: (after: string | undefined) => ({ userId, query: query || undefined, after, limit: 30 }),
    initialPageParam: undefined,
    getNextPageParam: (p) => p.nextAfter ?? undefined,
  });
