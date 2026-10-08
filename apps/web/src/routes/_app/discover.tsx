import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { DiscoverPage } from "@/features/discovery/discover-page";
import { requireSession } from "@/lib/session";
export const Route = createFileRoute("/_app/discover")({
  beforeLoad: requireSession,
  validateSearch: z.object({ q: z.string().max(100).optional().catch(undefined) }),
  component: () => <DiscoverPage query={Route.useSearch().q} />,
});
