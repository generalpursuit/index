import { personSummaryKey } from "@/data/seeding";
import { redirect } from "@tanstack/react-router";
import { client, apiFor } from "@/utils/orpc";
import type { QueryClient } from "@tanstack/react-query";
import type { ResolvedRoute } from "@/lib/types";
import { monday } from "@/lib/weeks";
import { weeksOptions, weekLinksOptions } from "@/features/links/queries";
import { groupsOptions } from "@/features/groups/queries";
import { profileOptions } from "@/features/profiles/queries";
import { linkPath } from "@index/api/routes";
export { profilePath, groupPath, linkPath, conversationPath } from "@index/api/routes";
export const isUUID = (value: string) =>
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
export const linkReferencePath = (value: string) =>
  `${isUUID(value) ? "/links/" : "/l/"}${encodeURIComponent(value)}`;
type RouteContext = {
  session: { user: { id: string; emailVerified?: boolean } } | null;
  queryClient: QueryClient;
};
type RouteLocation = { pathname: string; searchStr: string; hash: string; state?: unknown };
const api = (context: RouteContext) =>
  apiFor(context.session?.user.emailVerified ? context.session.user.id : null);
const routeOptions = (context: RouteContext, location: RouteLocation) =>
  api(context).routes.resolve.queryOptions({
    input: {
      path: location.pathname,
      group: new URLSearchParams(location.searchStr).get("group") ?? undefined,
    },
    staleTime: 30_000,
  });
/** Cached resolutions serve navigation; destination reads still enforce current access. */
export async function resolveLocation(context: RouteContext, location: RouteLocation) {
  const search = new URLSearchParams(location.searchStr);
  const result = await context.queryClient.ensureQueryData({
    ...routeOptions(context, location),
    revalidateIfStale: true,
  });
  search.delete("group");
  // Old modal/attachment URLs remain usable, but addresses written back contain short IDs.
  for (const key of ["post", "edit", "attach"]) {
    const value = search.get(key);
    if (value && isUUID(value)) {
      try {
        const link = await client.routes.resolve({ path: linkReferencePath(value) });
        search.set(key, link.canonicalPath.split("/").pop()!);
      } catch {
        search.delete(key);
      }
    }
  }
  const query = search.toString();
  const href =
    result.canonicalPath +
    (query ? "?" + query : "") +
    (location.hash ? "#" + location.hash.replace(/^#/, "") : "");
  const current =
    location.pathname +
    location.searchStr +
    (location.hash ? "#" + location.hash.replace(/^#/, "") : "");
  if (href !== current) throw redirect({ href, replace: true });
  return result;
}
/** Where a link said it goes (navigation state), or where the path last resolved. */
export type RouteHint = { userId?: string; groupId?: string; conversationId?: string };
export function routeHint(context: RouteContext, location: RouteLocation): RouteHint {
  const state = (location.state ?? {}) as Record<string, unknown>;
  const known: Partial<ResolvedRoute> =
    context.queryClient.getQueryData(routeOptions(context, location).queryKey) ?? {};
  // User IDs aren't UUIDs; any of these is only used once the path resolves to it.
  const id = (value: unknown) =>
    typeof value === "string" && /^[\w-]{1,64}$/.test(value) ? value : undefined;
  return {
    userId: id(state.userId) ?? ("userId" in known ? known.userId : undefined),
    groupId: id(state.groupId) ?? ("groupId" in known ? known.groupId : undefined),
    conversationId:
      id(state.conversationId) ?? ("conversationId" in known ? known.conversationId : undefined),
  };
}
/** A list row already knows its post; opening it needs no lookup before showing it. */
export function seedLinkRoute(
  cache: QueryClient,
  api: ReturnType<typeof apiFor>,
  link: { id: string; shortId: string },
) {
  const { queryKey } = api.routes.resolve.queryOptions({
    input: { path: linkReferencePath(link.shortId) },
  });
  const route: ResolvedRoute = {
    kind: "link",
    linkId: link.id,
    canonicalPath: linkPath(link.shortId),
  };
  if (!cache.getQueryData(queryKey)) cache.setQueryData(queryKey, route, { updatedAt: 0 });
}
export async function preloadProfile(context: RouteContext, userId: string, groupId?: string) {
  const cache = context.queryClient,
    profileApi = api(context);
  if (
    cache.getQueryData(personSummaryKey(profileApi, userId)) &&
    !cache.getQueryData(profileOptions(profileApi, userId).queryKey)
  ) {
    void cache.prefetchQuery(profileOptions(profileApi, userId));
    void cache.prefetchInfiniteQuery(groupsOptions(profileApi, userId));
    void cache.prefetchInfiniteQuery(weeksOptions(profileApi, userId, groupId));
    return;
  }
  const profile = cache.ensureQueryData(profileOptions(profileApi, userId));
  // Each list applies the profile's visibility itself, so they can start alongside it.
  const groups = cache.ensureInfiniteQueryData(groupsOptions(profileApi, userId));
  const weeks = cache.ensureInfiniteQueryData(weeksOptions(profileApi, userId, groupId));
  groups.catch(() => {});
  weeks.catch(() => {});
  if (!(await profile).canViewContent) return;
  const [, loaded] = await Promise.all([
    groups.catch(() => undefined),
    weeks.catch(() => undefined),
  ]);
  // The weeks that fill the first screen open with their links, including your empty current week.
  const shown = context.session?.user.id === userId ? [monday()] : [];
  let rows = 0;
  for (const week of loaded?.pages[0]?.items ?? []) {
    if (rows >= 24 || shown.length >= 4) break;
    if (!shown.includes(week.weekStart)) shown.push(week.weekStart);
    rows += week.count;
  }
  // A failed week shows its own retry; it doesn't hold the page.
  await Promise.allSettled(
    shown.map((week) =>
      cache.ensureInfiniteQueryData({
        ...weekLinksOptions(profileApi, userId, week, groupId),
        retry: false,
      }),
    ),
  );
}
