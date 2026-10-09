import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAPI } from "@/hooks/use-api";
import type { SavedLink } from "@/lib/types";
export function useGroups(ownerId: string) {
  const api = useAPI();
  return useInfiniteQuery(
    api.groups.list.infiniteOptions({
      input: (cursor: string | undefined) => ({
        ownerId,
        limit: 100,
        cursor,
      }),
      initialPageParam: undefined,
      getNextPageParam: (p) => p.nextCursor ?? undefined,
    }),
  );
}
export function useLink(id: string) {
  const api = useAPI();
  return useQuery(api.links.get.queryOptions({ input: { id } }));
}
export function useWeekLinks(
  userId: string,
  weekStart: string,
  groupId?: string,
  seed?: { items: SavedLink[]; nextCursor: string | null },
  updatedAt?: number,
) {
  const api = useAPI();
  const byOwner = api.links.listByOwner.infiniteOptions({
    input: (cursor: string | undefined) => ({ userId, weekStart, limit: 30, cursor }),
    initialPageParam: undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  // Group links also carry `ownerName` (read with `ownerOf`); both lists share one shape here.
  const options = groupId
    ? (api.links.listInGroup.infiniteOptions({
        input: (cursor: string | undefined) => ({ groupId, weekStart, limit: 30, cursor }),
        initialPageParam: undefined,
        getNextPageParam: (p) => p.nextCursor ?? undefined,
      }) as unknown as typeof byOwner)
    : byOwner;
  return useInfiniteQuery({
    ...options,
    initialData: seed ? () => ({ pages: [seed], pageParams: [undefined] }) : undefined,
    initialDataUpdatedAt: updatedAt,
  });
}
export function useLibraryWeeks(userId: string, groupId?: string, enabled = true) {
  const api = useAPI();
  return useInfiniteQuery(
    api.links.weeks.infiniteOptions({
      input: (before: string | undefined) => ({ userId, groupId, before, limit: 10 }),
      initialPageParam: undefined,
      getNextPageParam: (p) => p.nextBefore ?? undefined,
      enabled,
    }),
  );
}
export function useLibraryActions() {
  const api = useAPI(),
    cache = useQueryClient();
  const refresh = async () => {
    await Promise.all(
      [
        api.links.key(),
        api.groups.key(),
        api.feed.key(),
        api.favorites.key(),
        api.stars.key(),
        api.profiles.key(),
        api.messages.key(),
      ].map((queryKey) => cache.invalidateQueries({ queryKey })),
    );
  };
  const create = useMutation(api.links.create.mutationOptions({ onSuccess: refresh }));
  const update = useMutation(api.links.update.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(api.links.delete.mutationOptions({ onSuccess: refresh }));
  const createGroup = useMutation(api.groups.create.mutationOptions({ onSuccess: refresh }));
  const updateGroup = useMutation(api.groups.update.mutationOptions({ onSuccess: refresh }));
  const deleteGroup = useMutation(api.groups.delete.mutationOptions({ onSuccess: refresh }));
  const collect = useMutation({
    mutationFn: async ({ link, own }: { link: SavedLink; own: boolean }) => {
      if (own)
        return link.isFavorite
          ? api.favorites.remove.call({ linkId: link.id })
          : api.favorites.add.call({ linkId: link.id });
      return link.isStarred
        ? api.stars.remove.call({ linkId: link.id })
        : api.stars.add.call({ linkId: link.id });
    },
    onSuccess: refresh,
  });
  return { create, update, remove, createGroup, updateGroup, deleteGroup, collect };
}
export function useComments(linkId: string) {
  const api = useAPI(),
    cache = useQueryClient();
  const list = useInfiniteQuery(
    api.comments.list.infiniteOptions({
      input: (cursor: string | undefined) => ({ linkId, limit: 30, cursor }),
      initialPageParam: undefined,
      getNextPageParam: (p) => p.nextCursor ?? undefined,
    }),
  );
  const refresh = () => cache.invalidateQueries({ queryKey: api.comments.key() });
  const create = useMutation(api.comments.create.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(api.comments.delete.mutationOptions({ onSuccess: refresh }));
  return { list, create, remove };
}

/** Whose link this is, when the list says so (group lists do; Starred needs it). */
export const ownerOf = (link: SavedLink) =>
  "ownerName" in link && typeof link.ownerName === "string" ? link.ownerName : undefined;
