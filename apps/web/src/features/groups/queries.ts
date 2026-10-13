import type { apiFor } from "@/utils/orpc";
type API = ReturnType<typeof apiFor>;

export const groupsOptions = (api: API, ownerId: string) =>
  api.groups.list.infiniteOptions({
    input: (cursor: string | undefined) => ({ ownerId, limit: 100, cursor }),
    initialPageParam: undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
/** A link's group, for its name and who can see it. Links outside a group load nothing. */
export const groupOptions = (api: API, id: string | null) =>
  api.groups.get.queryOptions({
    input: { id: id ?? "00000000-0000-4000-8000-000000000000" },
    enabled: !!id,
  });
