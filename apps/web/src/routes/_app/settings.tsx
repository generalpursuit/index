import { createFileRoute } from "@tanstack/react-router";
import { apiFor } from "@/utils/orpc";
import { groupsOptions } from "@/features/links/queries";
import { SettingsPage } from "@/features/settings/settings-page";
import { requireSession } from "@/lib/session";

export const Route = createFileRoute("/_app/settings")({
  beforeLoad: requireSession,
  loader: ({ context }) => {
    const api = apiFor(context.session.user.id);
    return Promise.all([
      context.queryClient.ensureQueryData(
        api.profiles.get.queryOptions({ input: { userId: context.session.user.id } }),
      ),
      context.queryClient.ensureInfiniteQueryData(groupsOptions(api, context.session.user.id)),
    ]);
  },
  component: SettingsPage,
});
