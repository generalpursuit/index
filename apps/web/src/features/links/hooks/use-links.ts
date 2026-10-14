import { instantEdit, mapItems, viewerPath } from "@/data/edits";
import { onAccountClear } from "@/lib/account-boundary";
import { useRef } from "react";
import { useViewer } from "@/hooks/use-api";
import {
  useInfiniteQuery,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useAPI } from "@/hooks/use-api";
import type { SavedLink } from "@/lib/types";
import { linkOptions, weekLinksOptions, weeksOptions, commentsOptions } from "../queries";
type API = ReturnType<typeof useAPI>;
let membershipChanged = new WeakMap<QueryClient, boolean>();
onAccountClear(() => {
  membershipChanged = new WeakMap();
});
export function useLink(id: string) {
  return useQuery({ ...linkOptions(useAPI(), id), enabled: !!id });
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
    enabled: !!userId,
    initialData: seed ? () => ({ pages: [seed], pageParams: [undefined] }) : undefined,
    initialDataUpdatedAt: updatedAt,
  });
}
export function useLibraryWeeks(userId: string, groupId?: string, enabled = true) {
  return useInfiniteQuery({
    ...weeksOptions(useAPI(), userId, groupId),
    enabled: !!userId && enabled,
  });
}
/** Everything that lists links or counts them, after the library changes. */
export function refreshLibrary(cache: QueryClient, api: API) {
  return Promise.all(
    [
      api.links.listMine.key(),
      api.links.listByOwner.key(),
      api.links.listInGroup.key(),
      api.links.weeks.key(),
      api.groups.list.key(),
      api.feed.key(),
      api.profiles.get.key(),
    ].map((queryKey) => cache.invalidateQueries({ queryKey })),
  );
}
export function useLibraryActions() {
  const api = useAPI(),
    cache = useQueryClient(),
    viewer = useViewer();
  const affects = (key: import("@tanstack/react-query").QueryKey) =>
    viewerPath(key, viewer?.id ?? null, "links", "feed", "messages", "favorites", "stars");
  const patch =
    (id: string, change: (link: Record<string, unknown>) => unknown) => (data: unknown) =>
      mapItems(data, (item) => item.id === id && "url" in item && "shortId" in item, change);
  const membership = () => {
    if (!membershipChanged.get(cache)) return;
    membershipChanged.delete(cache);
    void cache.invalidateQueries({ queryKey: api.links.listInGroup.key() });
    for (const queryKey of [api.links.weeks.key(), api.groups.list.key(), api.profiles.get.key()])
      void cache.invalidateQueries({ queryKey });
  };
  const update = useMutation(
    instantEdit(cache, {
      key: ["link-edits", viewer?.id],
      affects,
      mutationFn: api.links.update.call,
      optimistic: ({ id, ...changes }) => {
        const previous = cache.getQueryData(linkOptions(api, id).queryKey);
        if (changes.groupId !== undefined && changes.groupId !== previous?.groupId)
          membershipChanged.set(cache, true);
        return patch(id, (link) => ({ ...link, ...changes }));
      },
      response: (link) => patch(link.id, (current) => ({ ...current, ...link })),
      invalidate: membership,
    }),
  );
  const remove = useMutation(
    instantEdit(cache, {
      key: ["link-edits", viewer?.id],
      affects,
      mutationFn: api.links.delete.call,
      optimistic: ({ id }) => {
        membershipChanged.set(cache, true);
        return patch(id, () => undefined);
      },
      invalidate: membership,
    }),
  );
  return { update, remove, collect: useCollect() };
}
type Collect = { link: SavedLink; own: boolean };
const collectKey = ["collect"];
/**
 * Keeps a link or lets it go: your own are Favorites, other people's are starred. The post
 * shows the change at once, and `useKept` shows it wherever else the link is listed.
 */
export function useCollect() {
  const api = useAPI(),
    cache = useQueryClient();
  const viewer = useViewer();
  return useMutation(
    instantEdit(cache, {
      key: collectKey,
      affects: (key) =>
        viewerPath(key, viewer?.id ?? null, "links", "feed", "messages", "favorites", "stars"),
      mutationFn: async ({ link, own }: Collect) => {
        if (own)
          return link.isFavorite
            ? api.favorites.remove.call({ linkId: link.id })
            : api.favorites.add.call({ linkId: link.id });
        return link.isStarred
          ? api.stars.remove.call({ linkId: link.id })
          : api.stars.add.call({ linkId: link.id });
      },
      optimistic: ({ link, own }) => {
        const removing = own ? link.isFavorite : link.isStarred;
        const collectionIds = new Set<string>();
        for (const query of cache.getQueryCache().findAll({ queryKey: api.groups.list.key() })) {
          mapItems(
            query.state.data,
            (item) => item.ownerId === viewer?.id && item.kind === (own ? "favorites" : "starred"),
            (item) => {
              collectionIds.add(String(item.id));
              return item;
            },
          );
        }
        return (data, key) => {
          const input = (key[1] as { input?: { groupId?: string } } | undefined)?.input;
          const removeFromCollection =
            removing && !!input?.groupId && collectionIds.has(input.groupId);
          return mapItems(
            data,
            (item) => item.id === link.id && "url" in item,
            (item) =>
              removeFromCollection
                ? undefined
                : {
                    ...item,
                    ...(own ? { isFavorite: !link.isFavorite } : { isStarred: !link.isStarred }),
                  },
          );
        };
      },
      invalidate: () => {
        void cache.invalidateQueries({ queryKey: api.links.listInGroup.key() });
        void cache.invalidateQueries({ queryKey: api.links.weeks.key() });
        void cache.invalidateQueries({ queryKey: api.groups.list.key() });
      },
    }),
  );
}
/**
 * Whether you keep the link, as a Favorite when it is your own and starred otherwise. A change
 * from any view counts while it is on its way; `changing` holds off the next one, which is
 * decided from this one's result.
 */
export function useKept(link: SavedLink, own: boolean) {
  const change = useMutationState({
    filters: {
      mutationKey: collectKey,
      status: "pending",
      predicate: (mutation) => (mutation.state.variables as Collect).link.id === link.id,
    },
    select: (mutation) => mutation.state.variables as Collect,
  }).at(-1);
  const kept = (of: SavedLink) => (own ? of.isFavorite : of.isStarred);
  return { kept: change ? !kept(change.link) : kept(link), changing: !!change };
}
export function useComments(linkId: string) {
  const api = useAPI(),
    cache = useQueryClient(),
    viewer = useViewer();
  const options = commentsOptions(api, linkId);
  const list = useInfiniteQuery({ ...options, enabled: !!linkId });
  const ids = useRef(new WeakMap<object, string>()).current;
  type Create = Parameters<typeof api.comments.create.call>[0];
  const create = useMutation(
    instantEdit(cache, {
      key: ["comments", viewer?.id, linkId],
      affects: (key) => JSON.stringify(key) === JSON.stringify(options.queryKey),
      mutationFn: api.comments.create.call,
      optimistic: (input: Create) => {
        const id = crypto.randomUUID();
        ids.set(input, id);
        const now = new Date().toISOString();
        const comment = {
          ...input,
          id,
          authorId: viewer!.id,
          author: viewer,
          createdAt: now,
          updatedAt: now,
        };
        return (data) => {
          const current = (data as typeof list.data) ?? {
            pages: [{ items: [], nextCursor: null }],
            pageParams: [undefined],
          };
          return (
            current && {
              ...current,
              pages: current.pages.map((page, index) =>
                index ? page : { ...page, items: [...page.items, comment] },
              ),
            }
          );
        };
      },
      response: (comment, input) => (data) => {
        const current = (data as typeof list.data) ?? {
          pages: [{ items: [], nextCursor: null }],
          pageParams: [undefined],
        };

        const returned = { ...comment, author: viewer! };
        const temporary = ids.get(input);
        const present = current.pages.some((page) =>
          page.items.some((item) => item.id === temporary || item.id === comment.id),
        );
        return {
          ...current,
          pages: current.pages.map((page, index) => ({
            ...page,
            items: present
              ? page.items.map((item) =>
                  item.id === temporary || item.id === comment.id ? returned : item,
                )
              : index
                ? page.items
                : [...page.items, returned],
          })),
        };
      },
    }),
  );
  const remove = useMutation(
    instantEdit(cache, {
      key: ["comments", viewer?.id, linkId],
      affects: (key) => JSON.stringify(key) === JSON.stringify(options.queryKey),
      mutationFn: api.comments.delete.call,
      optimistic:
        ({ id }) =>
        (data) =>
          mapItems(
            data,
            (item) => item.id === id,
            () => undefined,
          ),
    }),
  );
  return { list, create, remove };
}

/** Whose link this is, when the list says so (group lists do; Starred needs it). */
export const ownerOf = (link: SavedLink) =>
  "ownerName" in link && typeof link.ownerName === "string" ? link.ownerName : undefined;
