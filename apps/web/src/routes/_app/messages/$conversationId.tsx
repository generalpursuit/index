import { resolveLocation, linkReferencePath } from "@/lib/routes";
import { client } from "@/utils/orpc";
import { conversationOptions, messagesOptions } from "@/features/messages/queries";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ConversationPage } from "@/features/messages/messages-page";
import { requireSession } from "@/lib/session";
import { apiFor } from "@/utils/orpc";
export const Route = createFileRoute("/_app/messages/$conversationId")({
  beforeLoad: requireSession,
  validateSearch: z.object({ attach: z.string().optional().catch(undefined) }),
  loaderDeps: ({ search }) => ({ attach: search.attach }),
  loader: async ({ context, location, deps }) => {
    const result = await resolveLocation(location);
    if (result.kind !== "conversation") throw new Error("Destination not found.");
    const api = apiFor(context.session.user.id);
    const attachment = deps.attach
      ? await client.routes.resolve({ path: linkReferencePath(deps.attach) }).catch(() => null)
      : null;
    await Promise.all([
      context.queryClient.ensureQueryData(conversationOptions(api, result.conversationId)),
      context.queryClient.ensureInfiniteQueryData(messagesOptions(api, result.conversationId)),
    ]);
    return { ...result, attach: attachment?.kind === "link" ? attachment.linkId : undefined };
  },
  component: () => (
    <ConversationPage
      key={Route.useLoaderData().conversationId}
      id={Route.useLoaderData().conversationId}
      attach={Route.useLoaderData().attach}
    />
  ),
});
