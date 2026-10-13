import {
  accountMutationOptions,
  accountGeneration,
  assertCurrentAccount,
} from "@/lib/account-boundary";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useAPI } from "@/hooks/use-api";
import type { SavedLink } from "@/lib/types";
import { linkOptions, weekLinksOptions, weeksOptions, commentsOptions } from "../queries";
type API = ReturnType<typeof useAPI>;
export function useLink(id: string) {
  return useQuery(linkOptions(useAPI(), id));
}
export function useWeekLinks(
  userId: string,
  weekStart: string,
  groupId?: string,
  seed?: { items: SavedLink[]; nextCursor: string | null },
  updatedAt?: number,
) {
  return useInfiniteQuery({
    ...weekLinksOptions(useAPI(), userId, weekStart, groupId),
    initialData: seed ? () => ({ pages: [seed], pageParams: [undefined] }) : undefined,
    initialDataUpdatedAt: updatedAt,
  });
}
export function useLibraryWeeks(userId: string, groupId?: string, enabled = true) {
  return useInfiniteQuery({ ...weeksOptions(useAPI(), userId, groupId), enabled });
}
/** Everything that lists links or counts them, after the library changes. */
function refreshLibrary(cache: QueryClient, api: API) {
  return Promise.all(
    [
      api.links.listMine.key(),
      api.links.listByOwner.key(),
      api.links.listInGroup.key(),
      api.links.weeks.key(),
      api.groups.key(),
      api.feed.key(),
      api.favorites.key(),
      api.stars.key(),
      api.profiles.key(),
      api.messages.key(),
      api.routes.key(),
    ].map((queryKey) => cache.invalidateQueries({ queryKey })),
  );
}
export function useLibraryActions() {
  const api = useAPI(),
    cache = useQueryClient();
  const refresh = () => refreshLibrary(cache, api);
  const saved = async (link: SavedLink) => {
    const generation = accountGeneration();
    const queryKey = linkOptions(api, link.id).queryKey;
    await cache.cancelQueries({ queryKey, exact: true });
    assertCurrentAccount(generation);
    cache.setQueryData(queryKey, link);
    return refresh();
  };
  const update = useMutation(
    accountMutationOptions(api.links.update.mutationOptions({ onSuccess: saved })),
  );
  const remove = useMutation(
    accountMutationOptions(
      api.links.delete.mutationOptions({
        onSuccess: async (_, input) => {
          cache.removeQueries({ queryKey: linkOptions(api, input.id).queryKey, exact: true });
          await refresh();
        },
      }),
    ),
  );
  return { update, remove, collect: useCollect() };
}
type Collect = { link: SavedLink; own: boolean };
/** Keeps a link or lets it go: your own are Favorites, other people's are starred. */
export function useCollect() {
  const api = useAPI(),
    cache = useQueryClient();
  return useMutation(
    accountMutationOptions({
      mutationFn: async ({ link, own }: Collect) => {
        if (own)
          return link.isFavorite
            ? api.favorites.remove.call({ linkId: link.id })
            : api.favorites.add.call({ linkId: link.id });
        return link.isStarred
          ? api.stars.remove.call({ linkId: link.id })
          : api.stars.add.call({ linkId: link.id });
      },
      onMutate: async ({ link, own }) => {
        const generation = accountGeneration();
        const queryKey = linkOptions(api, link.id).queryKey;
        await cache.cancelQueries({ queryKey, exact: true });
        assertCurrentAccount(generation);
        const previous = cache.getQueryData(queryKey);
        cache.setQueryData(queryKey, {
          ...(previous ?? link),
          ...(own ? { isFavorite: !link.isFavorite } : { isStarred: !link.isStarred }),
        });
        return { queryKey, previous };
      },
      onError: (_, __, context) => {
        if (context?.previous) cache.setQueryData(context.queryKey, context.previous);
        else if (context) cache.removeQueries({ queryKey: context.queryKey, exact: true });
        if (context) void cache.invalidateQueries({ queryKey: context.queryKey, exact: true });
      },
      onSettled: () => refreshLibrary(cache, api),
    }),
  );
}
export function useComments(linkId: string) {
  const api = useAPI(),
    cache = useQueryClient();
  const list = useInfiniteQuery(commentsOptions(api, linkId));
  const refresh = () =>
    cache.invalidateQueries({ queryKey: api.comments.list.key({ input: { linkId } }) });
  const create = useMutation(
    accountMutationOptions(api.comments.create.mutationOptions({ onSuccess: refresh })),
  );
  const remove = useMutation(
    accountMutationOptions(api.comments.delete.mutationOptions({ onSuccess: refresh })),
  );
  return { list, create, remove };
}

/** Whose link this is, when the list says so (group lists do; Starred needs it). */
export const ownerOf = (link: SavedLink) =>
  "ownerName" in link && typeof link.ownerName === "string" ? link.ownerName : undefined;
