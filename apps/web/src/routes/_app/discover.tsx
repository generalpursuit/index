import { createFileRoute } from "@tanstack/react-router";
import { apiFor } from "@/utils/orpc";
import { recommendationsOptions } from "@/features/discovery/queries";
import { z } from "zod";
import { DiscoverPage } from "@/features/discovery/discover-page";
import { requireSession } from "@/lib/session";
export const Route = createFileRoute("/_app/discover")({
  beforeLoad: requireSession,
  validateSearch: z.object({ q: z.string().max(100).optional().catch(undefined) }),
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(recommendationsOptions(apiFor(context.session.user.id))),
  component: () => <DiscoverPage query={Route.useSearch().q} />,
});
