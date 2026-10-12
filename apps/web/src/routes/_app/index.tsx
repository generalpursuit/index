import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { FeedPage } from "@/features/feed/feed-page";
import { feedWeekOptions, feedWeeksOptions } from "@/features/feed/queries";
import { groupsOptions } from "@/features/groups/queries";
import { profileOptions } from "@/features/profiles/queries";
import { requireSession } from "@/lib/session";
import { weekSearch } from "@/lib/search";
import { monday } from "@/lib/weeks";
import { apiFor } from "@/utils/orpc";
export const Route = createFileRoute("/_app/")({
  staticData: { layout: "feed" },
  beforeLoad: requireSession,
  validateSearch: z.object({ week: weekSearch }),
  loaderDeps: ({ search }) => ({ week: search.week ?? monday() }),
  // Everything on the first screen, so nothing arrives after the page appears. Only the week
  // itself is required; the rest show their own errors and retry once the page is up.
  loader: ({ context, deps }) => {
    const api = apiFor(context.session.user.id),
      cache = context.queryClient;
    return Promise.all([
      cache.ensureInfiniteQueryData(feedWeekOptions(api, deps.week)),
      cache.prefetchInfiniteQuery({ ...feedWeeksOptions(api), retry: false }),
      cache.prefetchQuery({ ...profileOptions(api, context.session.user.id), retry: false }),
      cache.prefetchQuery({ ...api.profiles.me.queryOptions(), retry: false }),
      cache.prefetchInfiniteQuery({
        ...groupsOptions(api, context.session.user.id),
        retry: false,
      }),
    ]);
  },
  component: () => {
    const { week } = Route.useSearch();
    return <FeedPage week={week ?? monday()} />;
  },
});
