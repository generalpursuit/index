import { z } from "zod";
import { createLinkInputSchema, linkSchema } from "./schemas";
export const shareLinkInput = z.strictObject({
  url: createLinkInputSchema.shape.url.refine((raw) => {
    try {
      const url = new URL(raw);
      return !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Use a web link without embedded credentials."),
  groupId: z.uuid().nullable().default(null),
  requestId: z.uuid(),
  saveAgain: z.boolean().default(false),
});
export const shareLinkOutput = z.object({
  status: z.enum(["saved", "existing"]),
  link: linkSchema,
});
