import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "@/features/settings/settings-page";
import { requireSession } from "@/lib/session";

export const Route = createFileRoute("/_app/settings")({
  beforeLoad: requireSession,
  component: SettingsPage,
});
