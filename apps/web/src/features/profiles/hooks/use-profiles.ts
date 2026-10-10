import { accountMutationOptions } from "@/lib/account-boundary";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAPI } from "@/hooks/use-api";
import { sessionOptions } from "@/lib/session";
export function useProfile(userId: string, enabled = true) {
  const api = useAPI();
  return useQuery(api.profiles.get.queryOptions({ input: { userId }, enabled }));
}
export function useProfileActions() {
  const api = useAPI(),
    cache = useQueryClient();
  const refresh = async () => {
    await Promise.all(
      [
        api.profiles.key(),
        api.follows.key(),
        api.discovery.key(),
        api.feed.key(),
        api.groups.key(),
        api.links.key(),
        api.messages.key(),
        api.activity.key(),
      ].map((queryKey) => cache.invalidateQueries({ queryKey })),
    );
  };
  return {
    update: useMutation(
      accountMutationOptions(
        api.profiles.update.mutationOptions({
          onSuccess: async () => {
            await Promise.all([
              refresh(),
              cache.invalidateQueries({ queryKey: sessionOptions.queryKey }),
            ]);
          },
        }),
      ),
    ),
    uploadImage: useMutation(
      accountMutationOptions(
        api.profiles.uploadImage.mutationOptions({
          onSuccess: async () => {
            await Promise.all([
              refresh(),
              cache.invalidateQueries({ queryKey: sessionOptions.queryKey }),
            ]);
          },
        }),
      ),
    ),
    follow: useMutation(
      accountMutationOptions(api.follows.follow.mutationOptions({ onSuccess: refresh })),
    ),
    unfollow: useMutation(
      accountMutationOptions(api.follows.unfollow.mutationOptions({ onSuccess: refresh })),
    ),
    removeFollower: useMutation(
      accountMutationOptions(api.follows.removeFollower.mutationOptions({ onSuccess: refresh })),
    ),
    accept: useMutation(
      accountMutationOptions(api.follows.accept.mutationOptions({ onSuccess: refresh })),
    ),
    reject: useMutation(
      accountMutationOptions(api.follows.reject.mutationOptions({ onSuccess: refresh })),
    ),
  };
}
export function useConnections(userId: string, kind: "followers" | "following", query?: string) {
  const api = useAPI();
  return useInfiniteQuery(
    api.follows[kind].infiniteOptions({
      input: (after: string | undefined) => ({ userId, query, after, limit: 30 }),
      initialPageParam: undefined,
      getNextPageParam: (p) => p.nextAfter ?? undefined,
    }),
  );
}
