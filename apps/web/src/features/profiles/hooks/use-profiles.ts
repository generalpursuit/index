import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAPI } from "@/hooks/use-api";
export function useProfile(userId: string) {
  const api = useAPI();
  return useQuery(api.profiles.get.queryOptions({ input: { userId } }));
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
    update: useMutation(api.profiles.update.mutationOptions({ onSuccess: refresh })),
    follow: useMutation(api.follows.follow.mutationOptions({ onSuccess: refresh })),
    unfollow: useMutation(api.follows.unfollow.mutationOptions({ onSuccess: refresh })),
    removeFollower: useMutation(api.follows.removeFollower.mutationOptions({ onSuccess: refresh })),
    accept: useMutation(api.follows.accept.mutationOptions({ onSuccess: refresh })),
    reject: useMutation(api.follows.reject.mutationOptions({ onSuccess: refresh })),
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
