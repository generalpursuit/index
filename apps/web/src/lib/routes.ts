import { redirect } from "@tanstack/react-router";
import { client, apiFor } from "@/utils/orpc";
import type { QueryClient } from "@tanstack/react-query";
import { weeksOptions, weekLinksOptions } from "@/features/links/queries";
import { groupsOptions } from "@/features/groups/queries";
export { profilePath, groupPath, linkPath, conversationPath } from "@index/api/routes";
export const isUUID = (value: string) =>
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
export const linkReferencePath = (value: string) =>
  `${isUUID(value) ? "/links/" : "/l/"}${encodeURIComponent(value)}`;
/** Revalidate on each navigation, before disclosing even a canonical redirect. */
export async function resolveLocation(location: {
  pathname: string;
  searchStr: string;
  hash: string;
}) {
  const search = new URLSearchParams(location.searchStr);
  const result = await client.routes.resolve({
    path: location.pathname,
    group: search.get("group") ?? undefined,
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
export async function preloadProfile(
  context: { session: { user: { id: string } } | null; queryClient: QueryClient },
  userId: string,
  groupId?: string,
) {
  const api = apiFor(context.session?.user.id ?? null),
    cache = context.queryClient;
  const profile = await cache.ensureQueryData(api.profiles.get.queryOptions({ input: { userId } }));
  if (!profile.canViewContent) return;
  const [, weeks] = await Promise.all([
    cache.ensureInfiniteQueryData(groupsOptions(api, userId)),
    cache.ensureInfiniteQueryData(weeksOptions(api, userId, groupId)),
  ]);
  const first = weeks.pages[0]?.items[0];
  if (first)
    void cache.prefetchInfiniteQuery(weekLinksOptions(api, userId, first.weekStart, groupId));
}
