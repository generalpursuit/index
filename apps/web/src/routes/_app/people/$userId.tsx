import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { resolveLocation } from "@/lib/routes";
export const Route = createFileRoute("/_app/people/$userId")({
  validateSearch: z.object({ group: z.string().optional() }),
  loaderDeps: ({ search }) => ({ group: search.group }),
  loader: ({ context, location }) => resolveLocation(context, location),
});
