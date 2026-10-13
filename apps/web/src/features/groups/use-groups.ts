import { useEffect } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useAPI } from "@/hooks/use-api";
import { accountMutationOptions } from "@/lib/account-boundary";
import { groupsOptions } from "./queries";

export function useGroups(ownerId: string) {
  const groups = useInfiniteQuery(groupsOptions(useAPI(), ownerId));
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
    router = useRouter();
  const refreshGroups = () => cache.invalidateQueries({ queryKey: api.groups.key() });
  // Visibility/deletion changes access to links, profile lists and attached messages.
  const refreshAccess = () =>
    Promise.all([
      refreshGroups(),
      router.invalidate(),
      ...[
        api.links.key(),
        api.feed.key(),
        api.favorites.key(),
        api.stars.key(),
        api.profiles.key(),
        api.messages.key(),
        api.routes.key(),
      ].map((queryKey) => cache.invalidateQueries({ queryKey })),
    ]);
  return {
    createGroup: useMutation(
      accountMutationOptions(api.groups.create.mutationOptions({ onSuccess: refreshGroups })),
    ),
    updateGroup: useMutation(
      accountMutationOptions(api.groups.update.mutationOptions({ onSuccess: refreshAccess })),
    ),
    deleteGroup: useMutation(
      accountMutationOptions(api.groups.delete.mutationOptions({ onSuccess: refreshAccess })),
    ),
  };
}
