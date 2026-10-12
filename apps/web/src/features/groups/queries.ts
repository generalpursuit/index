import type { apiFor } from "@/utils/orpc";
type API = ReturnType<typeof apiFor>;

export const groupsOptions = (api: API, ownerId: string) =>
  api.groups.list.infiniteOptions({
    input: (cursor: string | undefined) => ({ ownerId, limit: 100, cursor }),
    initialPageParam: undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
