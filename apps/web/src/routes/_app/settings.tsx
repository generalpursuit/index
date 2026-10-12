import { createFileRoute } from "@tanstack/react-router";
import { apiFor } from "@/utils/orpc";
import { groupsOptions } from "@/features/groups/queries";
import { profileOptions } from "@/features/profiles/queries";
import { SettingsPage } from "@/features/settings/settings-page";
import { requireSession } from "@/lib/session";

export const Route = createFileRoute("/_app/settings")({
  beforeLoad: requireSession,
  loader: ({ context }) => {
    const api = apiFor(context.session.user.id);
    return Promise.all([
      context.queryClient.ensureQueryData(profileOptions(api, context.session.user.id)),
      context.queryClient.ensureInfiniteQueryData(groupsOptions(api, context.session.user.id)),
      // Below the fold; they show their own errors and retry once the page is up.
      context.queryClient.prefetchQuery({
        ...api.notifications.preferences.queryOptions({ input: {} }),
        retry: false,
      }),
      context.queryClient.prefetchQuery({
        ...api.notifications.capabilities.queryOptions({ input: {} }),
        retry: false,
      }),
    ]);
  },
  component: SettingsPage,
});
