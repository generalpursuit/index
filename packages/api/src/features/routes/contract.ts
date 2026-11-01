import { openapi } from "@orpc/openapi";
import { agentTool } from "../../agent-tools";
import { z } from "zod";
import { baseContract, optionalAuth } from "../../shared/schemas";
export const resolvedRouteSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("profile"), userId: z.string(), canonicalPath: z.string() }),
  z.object({
    kind: z.literal("group"),
    userId: z.string(),
    groupId: z.uuid(),
    canonicalPath: z.string(),
  }),
  z.object({ kind: z.literal("link"), linkId: z.uuid(), canonicalPath: z.string() }),
  z.object({
    kind: z.literal("conversation"),
    conversationId: z.uuid(),
    canonicalPath: z.string(),
  }),
]);
export type ResolvedRoute = z.infer<typeof resolvedRouteSchema>;
export const routesContract = {
  resolve: baseContract
    .meta(
      openapi({
        method: "GET",
        path: "/routes/resolve",
        tags: ["Routes"],
        spec: optionalAuth,
        summary: "Resolve an Index address",
        description:
          "Turns the path of an Index web address into what it shows, with the IDs the other operations take: a person (`/u/alice`), one of their groups (`/u/alice/reading`), a link (`/l/` and its short ID) or one of the user's conversations. Addresses the signed-in user may not open return not found, exactly like missing ones. It reads only Index addresses, never other websites.",
      }),
      agentTool({ name: "resolve_index_url", permission: "read" }),
    )
    .input(
      z.strictObject({
        path: z
          .string()
          .min(1)
          .max(2048)
          .describe(
            "The address's path: everything after the domain, starting with `/`, without the `?` query or `#` fragment.",
          ),
        group: z
          .string()
          .max(128)
          .optional()
          .describe("The `group` query parameter of an older address, if it has one."),
      }),
    )
    .output(resolvedRouteSchema),
};
