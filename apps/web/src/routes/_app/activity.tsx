import { PendingPage } from "@/components/app/query-state";
import { createFileRoute } from "@tanstack/react-router";
import { apiFor } from "@/utils/orpc";
import { activityOptions } from "@/features/activity/queries";
import { z } from "zod";
import { ActivityPage } from "@/features/activity/activity-page";
import { requireSession } from "@/lib/session";
export const Route = createFileRoute("/_app/activity")({
  beforeLoad: requireSession,
  validateSearch: z.object({
    filter: z.enum(["all", "comment", "request", "mention", "follow"]).optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ type: search.filter === "all" ? undefined : search.filter }),
  loader: ({ context, deps }) =>
    context.queryClient
      .ensureInfiniteQueryData(activityOptions(apiFor(context.session.user.id), deps.type))
      .then(() => {}),
  pendingComponent: () => (
    <PendingPage>
      <ActivityPage />
    </PendingPage>
  ),
  component: () => <ActivityPage filter={Route.useSearch().filter} />,
});
