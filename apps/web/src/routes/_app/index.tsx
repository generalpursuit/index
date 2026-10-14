import { PendingPage } from "@/components/app/query-state";
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
  loader: ({ context, deps }) => {
    const api = apiFor(context.session.user.id),
      cache = context.queryClient;
    void cache.prefetchInfiniteQuery({ ...feedWeeksOptions(api), retry: false });
    void cache.prefetchQuery({ ...profileOptions(api, context.session.user.id), retry: false });
    void cache.prefetchInfiniteQuery({
      ...groupsOptions(api, context.session.user.id),
      retry: false,
    });
    return cache.ensureInfiniteQueryData(feedWeekOptions(api, deps.week)).then(() => {});
  },
  pendingComponent: () => (
    <PendingPage>
      <FeedPage week={monday()} />
    </PendingPage>
  ),
  component: () => {
    const { week } = Route.useSearch();
    return <FeedPage week={week ?? monday()} />;
  },
});
