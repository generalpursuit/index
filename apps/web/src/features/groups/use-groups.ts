import { instantEdit, mapItems, viewerPath } from "@/data/edits";
import { useViewer } from "@/hooks/use-api";
import { groupSlug } from "@index/api/routes";
import { useEffect } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useAPI } from "@/hooks/use-api";
import { groupsOptions } from "./queries";

export function useGroups(ownerId: string) {
  const groups = useInfiniteQuery({ ...groupsOptions(useAPI(), ownerId), enabled: !!ownerId });
  return {
    ...groups,
    complete: !!groups.data && !groups.hasNextPage && !groups.isError && !groups.isFetching,
  };
}
/**
 * Profile lists, lock markers and save destinations need the whole group index, including later
 * pages.
 */
export function useAllGroups(ownerId: string) {
  const groups = useGroups(ownerId);
  const { hasNextPage, isFetching, isError, fetchNextPage } = groups;
  useEffect(() => {
    // Several parts of a page may load the same index; they share one request for each page.
    if (hasNextPage && !isFetching && !isError) void fetchNextPage({ cancelRefetch: false });
  }, [hasNextPage, isFetching, isError, fetchNextPage]);
  return groups;
}
export function useGroupActions() {
  const api = useAPI(),
    cache = useQueryClient(),
    router = useRouter(),
    viewer = useViewer();
  const affects = (key: import("@tanstack/react-query").QueryKey) =>
    viewerPath(key, viewer?.id ?? null, "groups", "links", "feed", "messages");
  const patch =
    (id: string, change: (group: Record<string, unknown>) => unknown) => (data: unknown) =>
      mapItems(data, (item) => item.id === id && "kind" in item && "slug" in item, change);
  const refreshAccess = () => {
    void cache.invalidateQueries({ queryKey: api.routes.key() });
    void cache.invalidateQueries({ queryKey: api.links.weeks.key() });
    void cache.invalidateQueries({ queryKey: api.groups.list.key() });
    void router.invalidate();
  };
  return {
    createGroup: useMutation(
      instantEdit(cache, {
        key: ["group-edits", viewer?.id],
        affects,
        mutationFn: api.groups.create.call,
        optimistic: (input) => {
          const id = crypto.randomUUID();
          const now = new Date().toISOString();
          const group = {
            id,
            ownerId: viewer!.id,
            name: input.name,
            slug: groupSlug(input.name),
            visibility: input.visibility ?? "public",
            kind: "custom",
            createdAt: now,
            updatedAt: now,
            linkCount: 0,
            pending: true,
          };
          return (data, key) => {
            if (
              (key[0] as string[])[2] !== "groups" ||
              (key[0] as string[])[3] !== "list" ||
              (key[1] as { input?: { ownerId?: string } }).input?.ownerId !== viewer?.id
            )
              return data;
            const current = data as ReturnType<typeof useGroups>["data"];
            return (
              current && {
                ...current,
                pages: current.pages.map((page, index) =>
                  index ? page : { ...page, items: [...page.items, group] },
                ),
              }
            );
          };
        },
        response: (group) => (data, key) => {
          if (
            (key[0] as string[])[2] !== "groups" ||
            (key[0] as string[])[3] !== "list" ||
            (key[1] as { input?: { ownerId?: string } }).input?.ownerId !== viewer?.id
          )
            return data;
          const current = data as ReturnType<typeof useGroups>["data"];
          return (
            current && {
              ...current,
              pages: current.pages.map((page, index) =>
                index
                  ? page
                  : {
                      ...page,
                      items: [
                        ...page.items.filter((item) => item.id !== group.id),
                        { ...group, linkCount: 0 },
                      ],
                    },
              ),
            }
          );
        },
      }),
    ),
    updateGroup: useMutation(
      instantEdit(cache, {
        key: ["group-edits", viewer?.id],
        affects,
        mutationFn: api.groups.update.call,
        optimistic: ({ id, ...changes }) => patch(id, (group) => ({ ...group, ...changes })),
        response: (group) => patch(group.id, (current) => ({ ...current, ...group })),
        invalidate: refreshAccess,
      }),
    ),
    deleteGroup: useMutation(
      instantEdit(cache, {
        key: ["group-edits", viewer?.id],
        affects,
        mutationFn: api.groups.delete.call,
        optimistic:
          ({ id, deleteLinks }) =>
          (data) =>
            mapItems(
              patch(id, () => undefined)(data),
              (item) => item.groupId === id && "url" in item,
              (link) => (deleteLinks ? undefined : { ...link, groupId: null }),
            ),
        invalidate: refreshAccess,
      }),
    ),
  };
}
