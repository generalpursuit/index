import { createFileRoute } from "@tanstack/react-router";
import { MessagesPage } from "@/features/messages/messages-page";
import { requireSession } from "@/lib/session";
export const Route = createFileRoute("/_app/messages/")({
  beforeLoad: requireSession,
  component: MessagesPage,
});
