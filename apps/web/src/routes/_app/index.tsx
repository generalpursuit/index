import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { FeedPage } from "@/features/feed/feed-page";
import { requireSession } from "@/lib/session";
import { weekSearch } from "@/lib/search";
import { monday } from "@/lib/weeks";
import { apiFor } from "@/utils/orpc";
export const Route = createFileRoute("/_app/")({
  beforeLoad: requireSession,
  validateSearch: z.object({ week: weekSearch }),
  loaderDeps: ({ search }) => ({ week: search.week ?? monday() }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureInfiniteQueryData(
      apiFor(context.session.user.id).feed.week.infiniteOptions({
        input: (after: string | undefined) => ({
          weekStart: deps.week,
          after,
          limit: 10,
          linkLimit: 20,
        }),
        initialPageParam: undefined,
        getNextPageParam: (p) => p.nextAfter ?? undefined,
      }),
    ),
  component: () => {
    const { week } = Route.useSearch();
    return <FeedPage week={week ?? monday()} />;
  },
});
