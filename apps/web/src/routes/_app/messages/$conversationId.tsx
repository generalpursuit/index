import { PendingPage } from "@/components/app/query-state";
import { resolveLocation, linkReferencePath, routeHint } from "@/lib/routes";
import { client } from "@/utils/orpc";
import { conversationOptions, messagesOptions } from "@/features/messages/queries";
import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { z } from "zod";
import { ConversationPage } from "@/features/messages/messages-page";
import { requireSession } from "@/lib/session";
import { apiFor } from "@/utils/orpc";
export const Route = createFileRoute("/_app/messages/$conversationId")({
  staticData: { layout: "chat" },
  beforeLoad: requireSession,
  validateSearch: z.object({ attach: z.string().optional().catch(undefined) }),
  loaderDeps: ({ search }) => ({ attach: search.attach }),
  loader: async ({ context, location, deps }) => {
    const api = apiFor(context.session.user.id);
    const load = (id: string) =>
      Promise.all([
        context.queryClient.ensureQueryData(conversationOptions(api, id)),
        context.queryClient.ensureInfiniteQueryData(messagesOptions(api, id)),
      ]);
    const { conversationId } = routeHint(context, location);
    if (conversationId) void load(conversationId).catch(() => {});
    const attachment = deps.attach
      ? client.routes.resolve({ path: linkReferencePath(deps.attach) }).catch(() => null)
      : null;
    const result = await resolveLocation(context, location);
    if (result.kind !== "conversation") throw new Error("Destination not found.");
    const [attached] = await Promise.all([attachment, load(result.conversationId)]);
    return { ...result, attach: attached?.kind === "link" ? attached.linkId : undefined };
  },
  pendingComponent: PendingConversation,
  component: () => (
    <ConversationPage
      key={Route.useLoaderData().conversationId}
      id={Route.useLoaderData().conversationId}
      attach={Route.useLoaderData().attach}
    />
  ),
});
function PendingConversation() {
  const id = useRouterState({ select: (state) => state.location.state.conversationId });
  return (
    <PendingPage>
      <ConversationPage id={id ?? ""} />
    </PendingPage>
  );
}
