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
    .route({ method: "GET", path: "/routes/resolve", tags: ["Routes"], spec: optionalAuth })
    .input(
      z.strictObject({ path: z.string().min(1).max(2048), group: z.string().max(128).optional() }),
    )
    .output(resolvedRouteSchema),
};
