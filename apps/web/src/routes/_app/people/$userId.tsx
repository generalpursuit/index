import { groupsOptions, weeksOptions, weekLinksOptions } from "@/features/links/queries";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ProfilePage } from "@/features/profiles/profile-page";
import { apiFor } from "@/utils/orpc";
export const Route = createFileRoute("/_app/people/$userId")({
  validateSearch: z.object({
    group: z
      .union([z.uuid(), z.literal("starred")])
      .optional()
      .catch(undefined),
    // Phones open Settings as a sheet over your profile.
    settings: z.boolean().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ group: search.group }),
  loader: async ({ context, params, deps }) => {
    const api = apiFor(context.session?.user.id ?? null),
      cache = context.queryClient;
    const profile = await cache.ensureQueryData(
      api.profiles.get.queryOptions({ input: { userId: params.userId } }),
    );
    if (!profile.canViewContent) return;
    const groupOptions = groupsOptions(api, params.userId);
    let groupId = deps.group;
    if (groupId === "starred") {
      const groups = await cache.ensureInfiniteQueryData(groupOptions);
      groupId = groups.pages.flatMap((p) => p.items).find((g) => g.kind === "starred")?.id;
      if (!groupId) return;
    }
    const [, weeks] = await Promise.all([
      cache.ensureInfiniteQueryData(groupOptions),
      cache.ensureInfiniteQueryData(weeksOptions(api, params.userId, groupId)),
    ]);
    const first = weeks.pages[0]?.items[0];
    if (first)
      void cache.prefetchInfiniteQuery(
        weekLinksOptions(api, params.userId, first.weekStart, groupId),
      );
  },
  component: () => {
    const { group, settings } = Route.useSearch();
    return <ProfilePage userId={Route.useParams().userId} group={group} settings={settings} />;
  },
});
