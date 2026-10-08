import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AddLinkPage } from "@/features/links/add-link-page";
import { requireSession } from "@/lib/session";
import { weekSearch } from "@/lib/search";
export const Route = createFileRoute("/_app/add")({
  beforeLoad: requireSession,
  validateSearch: z.object({
    week: weekSearch,
    group: z.uuid().optional().catch(undefined),
    edit: z.uuid().optional().catch(undefined),
  }),
  component: () => <AddLinkPage {...Route.useSearch()} />,
});
