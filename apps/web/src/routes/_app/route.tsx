import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/shell";
import { sessionOptions } from "@/lib/session";
import { appSearch } from "@/lib/search";
export const Route = createFileRoute("/_app")({
  validateSearch: appSearch,
  beforeLoad: async ({ context }) => ({
    session: await context.queryClient.ensureQueryData(sessionOptions),
  }),
  component: AppShell,
});
