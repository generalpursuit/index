import type { apiFor } from "@/utils/orpc";
type API = ReturnType<typeof apiFor>;
export const recommendationsOptions = (api: API) =>
  api.discovery.recommendations.queryOptions({ input: { limit: 30 } });
export const searchPeopleOptions = (api: API, query: string) =>
  api.discovery.searchUsers.infiniteOptions({
    input: (after: string | undefined) => ({ query, after, limit: 30 }),
    initialPageParam: undefined,
    getNextPageParam: (p) => p.nextAfter ?? undefined,
  });
