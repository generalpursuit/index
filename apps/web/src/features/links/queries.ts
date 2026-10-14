import { canPrefetch } from "@/data/client";
import { mapItems } from "@/data/edits";
import { seedPerson } from "@/data/seeding";
import type { Group, Person } from "@/lib/types";
import type { QueryClient } from "@tanstack/react-query";
import type { apiFor } from "@/utils/orpc";
import type { SavedLink } from "@/lib/types";
import { seedLinkRoute } from "@/lib/routes";
import { groupOptions } from "@/features/groups/queries";
import { profileOptions } from "@/features/profiles/queries";
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
  if (!cache.isMutating() && !cache.getQueryData(options.queryKey))
    cache.setQueryData(options.queryKey, link);
  for (const query of cache.getQueryCache().getAll()) {
    mapItems(
      query.state.data,
      (item) =>
        (item.id === link.ownerId &&
          typeof item.name === "string" &&
          "profileVisibility" in item) ||
        (item.id === link.groupId && "kind" in item),
      (item) => {
        if (item.id === link.ownerId) seedPerson(cache, api, item as Person);
        else if (
          !cache.isMutating() &&
          link.groupId &&
          !cache.getQueryData(groupOptions(api, link.groupId).queryKey)
        )
          cache.setQueryData(groupOptions(api, link.groupId).queryKey, item as Group);
        return item;
      },
    );
  }
  preparePostReference(cache, api, link);
  if (!canPrefetch()) return;
  void cache.prefetchQuery(api.profiles.get.queryOptions({ input: { userId: link.ownerId } }));
  if (link.groupId) void cache.prefetchQuery(groupOptions(api, link.groupId));
}
/** What opening a post needs when only its identifiers are known. */
export function preparePostReference(
  cache: QueryClient,
  api: API,
  link: { id: string; shortId: string },
) {
  seedLinkRoute(cache, api, link);
  if (!canPrefetch()) return;
  void cache.prefetchQuery(linkOptions(api, link.id));
  void cache.prefetchInfiniteQuery(commentsOptions(api, link.id));
}
/**
 * Everything a post shows when it opens, for a loader: the link, its comments, and the group
 * and author it names. The post still opens if the group or author can't be read.
 */
export async function loadPost(cache: QueryClient, api: API, linkId: string) {
  const link = await cache.ensureQueryData(linkOptions(api, linkId));
  if (link.groupId) void cache.prefetchQuery(groupOptions(api, link.groupId));
  void cache.prefetchQuery(profileOptions(api, link.ownerId));
  void cache.prefetchInfiniteQuery(commentsOptions(api, linkId));
}
