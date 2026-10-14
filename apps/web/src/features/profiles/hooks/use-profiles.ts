import { patchRelationship } from "../edits";
import { instantEdit, mapItems, viewerPath } from "@/data/edits";
import { useViewer } from "@/hooks/use-api";
import { profileSummary } from "@/data/seeding";
import { useRouter } from "@tanstack/react-router";
import { accountMutationOptions, onAccountClear } from "@/lib/account-boundary";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useAPI } from "@/hooks/use-api";
import { sessionOptions } from "@/lib/session";
import { contentFeatures } from "@/data/content";
import { connectionsOptions, profileOptions } from "../queries";
let accessChanged = new WeakMap<QueryClient, boolean>();
onAccountClear(() => {
  accessChanged = new WeakMap();
});
export function useProfile(userId: string, enabled = true) {
  const api = useAPI(),
    cache = useQueryClient();
  return useQuery({
    ...profileOptions(api, userId),
    enabled: enabled && !!userId,
    placeholderData: () => profileSummary(cache, api, userId),
  });
}
export function useProfileActions() {
  const router = useRouter(),
    api = useAPI(),
    cache = useQueryClient(),
    viewer = useViewer();
  const affected = (key: import("@tanstack/react-query").QueryKey) =>
    viewerPath(key, viewer?.id ?? null, ...contentFeatures);
  const refreshPrivateAccess = () => {
    if (!accessChanged.get(cache)) return;
    accessChanged.delete(cache);
    // Revocation changes attachments in loaded history too, beyond the pulse's first page.
    void cache.invalidateQueries({
      predicate: (query) =>
        viewerPath(
          query.queryKey,
          viewer?.id ?? null,
          "links",
          "groups",
          "messages",
          "favorites",
          "stars",
          "comments",
        ),
    });
  };
  const identityPatch = (changes: Record<string, unknown>) => (data: unknown) =>
    mapItems(
      data,
      (item) => item.id === viewer?.id && "name" in item,
      (item) => ({ ...item, ...changes }),
    );
  const update = useMutation(
    instantEdit(cache, {
      key: ["person-edits", viewer?.id],
      affects: affected,
      mutationFn: api.profiles.update.call,
      optimistic: (changes) => identityPatch(changes),
      response: (profile) => identityPatch(profile),
      invalidate: () => {
        refreshPrivateAccess();
        void cache.invalidateQueries({ queryKey: sessionOptions.queryKey });
        void cache.invalidateQueries({ queryKey: api.routes.key() });
        void router.invalidate();
      },
    }),
  );
  const refreshRelationship = () => {
    refreshPrivateAccess();
    for (const queryKey of [
      api.follows.key(),
      api.feed.key(),
      profileOptions(api, viewer!.id).queryKey,
    ])
      void cache.invalidateQueries({ queryKey });
    window.dispatchEvent(new Event("index:pulse"));
  };
  const privateProfile = (id: string) => {
    for (const query of cache.getQueryCache().getAll()) {
      let hidden = false;
      mapItems(
        query.state.data,
        (item) => item.id === id && "profileVisibility" in item,
        (item) => {
          hidden ||= item.profileVisibility === "private";
          return item;
        },
      );
      if (hidden) return true;
    }
    return false;
  };
  const relationship = <T extends { userId: string }, R>(
    call: (input: T) => Promise<R>,
    status: "pending" | "accepted" | null,
    requestStatus?: string,
  ) =>
    instantEdit(cache, {
      key: ["person-edits", viewer?.id],
      affects: affected,
      mutationFn: call,
      optimistic: ({ userId }: T) => {
        const hidden = !requestStatus && status === null && privateProfile(userId);
        if (hidden) accessChanged.set(cache, true);
        const hiddenPosts = hidden ? new Set<string>() : undefined;
        if (hiddenPosts)
          for (const query of cache.getQueryCache().getAll())
            mapItems(
              query.state.data,
              (item) => item.ownerId === userId && "url" in item,
              (item) => {
                hiddenPosts.add(String(item.id));
                return item;
              },
            );
        return patchRelationship(
          userId,
          status === "accepted" && !requestStatus && privateProfile(userId) ? "pending" : status,
          requestStatus,
          hiddenPosts,
        );
      },
      response:
        status === null && !requestStatus
          ? undefined
          : (result, { userId }) =>
              patchRelationship(
                userId,
                typeof result === "object" && result && "status" in result
                  ? (result.status as "pending" | "accepted")
                  : status,
                requestStatus,
              ),
      invalidate: refreshRelationship,
    });
  return {
    update,
    uploadImage: useMutation(
      accountMutationOptions(
        api.profiles.uploadImage.mutationOptions({
          onSuccess: (profile) => {
            for (const query of cache
              .getQueryCache()
              .findAll({ predicate: (query) => affected(query.queryKey) }))
              cache.setQueryData(query.queryKey, identityPatch(profile)(query.state.data));
            void cache.invalidateQueries({ queryKey: sessionOptions.queryKey });
          },
        }),
      ),
    ),
    follow: useMutation(relationship(api.follows.follow.call, "accepted")),
    unfollow: useMutation(relationship(api.follows.unfollow.call, null)),
    removeFollower: useMutation(
      instantEdit(cache, {
        key: ["person-edits", viewer?.id],
        affects: affected,
        mutationFn: api.follows.removeFollower.call,
        optimistic:
          ({ userId }) =>
          (data, key) =>
            (key[0] as string[])[3] === "followers" &&
            (key[1] as { input?: { userId?: string } }).input?.userId === viewer?.id
              ? mapItems(
                  data,
                  (item) => item.id === userId,
                  () => undefined,
                )
              : data,
        invalidate: refreshRelationship,
      }),
    ),
    accept: useMutation(relationship(api.follows.accept.call, "accepted", "accepted")),
    reject: useMutation(relationship(api.follows.reject.call, null, "declined")),
  };
}
export function useConnections(userId: string, kind: "followers" | "following", query?: string) {
  return useInfiniteQuery({
    ...connectionsOptions(useAPI(), userId, kind, query),
    placeholderData: keepPreviousData,
  });
}
