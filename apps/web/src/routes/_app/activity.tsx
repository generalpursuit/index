import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ActivityPage } from "@/features/activity/activity-page";
import { requireSession } from "@/lib/session";
export const Route = createFileRoute("/_app/activity")({
  beforeLoad: requireSession,
  validateSearch: z.object({
    filter: z.enum(["all", "comment", "request", "mention", "follow"]).optional().catch(undefined),
  }),
  component: () => <ActivityPage filter={Route.useSearch().filter} />,
});
