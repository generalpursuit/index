import { createFileRoute } from "@tanstack/react-router";
import { resolveLocation } from "@/lib/routes";
export const Route = createFileRoute("/_app/links/$linkId")({
  loader: ({ location }) => resolveLocation(location),
});
