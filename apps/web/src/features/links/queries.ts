import type { QueryClient } from "@tanstack/react-query";
import type { apiFor } from "@/utils/orpc";
import type { SavedLink } from "@/lib/types";
import { seedLinkRoute } from "@/lib/routes";
type API = ReturnType<typeof apiFor>;

export const linkOptions = (api: API, id: string) => api.links.get.queryOptions({ input: { id } });
export const weeksOptions = (api: API, userId: string, groupId?: string) =>
  api.links.weeks.infiniteOptions({
    input: (before: string | undefined) => ({ userId, groupId, before, limit: 10 }),
    initialPageParam: undefined,
    getNextPageParam: (p) => p.nextBefore ?? undefined,
  });
export function weekLinksOptions(api: API, userId: string, weekStart: string, groupId?: string) {
  const own = api.links.listByOwner.infiniteOptions({
    input: (cursor: string | undefined) => ({ userId, weekStart, limit: 30, cursor }),
    initialPageParam: undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  return groupId
    ? (api.links.listInGroup.infiniteOptions({
        input: (cursor: string | undefined) => ({ groupId, weekStart, limit: 30, cursor }),
        initialPageParam: undefined,
        getNextPageParam: (p) => p.nextCursor ?? undefined,
      }) as unknown as typeof own)
    : own;
}
export const commentsOptions = (api: API, linkId: string) =>
  api.comments.list.infiniteOptions({
    input: (cursor: string | undefined) => ({ linkId, limit: 30, cursor }),
    initialPageParam: undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });

/** A row is already readable. Keep it visible while rechecking details and permissions. */
export function preparePost(cache: QueryClient, api: API, link: SavedLink) {
  const options = linkOptions(api, link.id);
  if (!cache.getQueryData(options.queryKey))
    cache.setQueryData(options.queryKey, link, { updatedAt: 0 });
  preparePostReference(cache, api, link);
  void cache.prefetchQuery(api.profiles.get.queryOptions({ input: { userId: link.ownerId } }));
}
/** What opening a post needs when only its identifiers are known. */
export function preparePostReference(
  cache: QueryClient,
  api: API,
  link: { id: string; shortId: string },
) {
  seedLinkRoute(cache, api, link);
  void cache.prefetchQuery(linkOptions(api, link.id));
  void cache.prefetchInfiniteQuery(commentsOptions(api, link.id));
}
