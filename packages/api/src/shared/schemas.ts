import { oc } from "@orpc/contract";
import { z } from "zod";

export const baseContract = oc.errors({
  BAD_REQUEST: { message: "Invalid input." },
  UNAUTHORIZED: { message: "Sign in to continue." },
  NOT_FOUND: { message: "Resource not found." },
  CONFLICT: { message: "Resource conflict." },
  INTERNAL_SERVER_ERROR: { message: "Something went wrong." },
});

export const pageLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(100)
  .default(20)
  .describe("How many items to return, from 1 to 100. Defaults to 20.");
export const pageCursorSchema = z
  .string()
  .min(1)
  .max(512)
  .optional()
  .describe(
    "The `nextCursor` of the previous page, passed back unchanged to continue the list. Omit it for the first page.",
  );
export const pageInputSchema = z.strictObject({ limit: pageLimitSchema, cursor: pageCursorSchema });
export const userIdSchema = z.string().min(1).max(128);
export const userPageInputSchema = z.strictObject({
  limit: pageLimitSchema,
  after: userIdSchema
    .optional()
    .describe(
      "The `nextAfter` of the previous page, passed back unchanged to continue the list. Omit it for the first page.",
    ),
});
export const idInputSchema = z.strictObject({ id: z.uuid() });
export const successSchema = z.object({ success: z.literal(true) });
export const visibilitySchema = z.enum(["public", "private"]);
export const httpUrlSchema = z
  .url({ protocol: /^https?$/ })
  .trim()
  .max(8192);

// Public reads also accept credentials to reveal content available to that viewer.
export const optionalAuth: { security: Record<string, string[]>[] } = {
  security: [{}, { bearerAuth: [] }, { sessionCookie: [] }],
};
