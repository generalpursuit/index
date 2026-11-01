import { z } from "zod";
import { createLinkInputSchema, linkSchema } from "./schemas";
export const shareLinkInput = z.strictObject({
  url: createLinkInputSchema.shape.url
    .refine((raw) => {
      try {
        const url = new URL(raw);
        return !url.username && !url.password;
      } catch {
        return false;
      }
    }, "Use a web link without embedded credentials.")
    .describe("The http(s) address to save, without a user name or password in it."),
  groupId: z
    .uuid()
    .nullable()
    .default(null)
    .describe("One of your own groups to save into. Null or omitted saves into Your links."),
  requestId: z
    .uuid()
    .describe(
      "A new random UUID for each save. Reuse it, with the same other fields, only to retry a save whose outcome is unknown: the retry then returns that save instead of saving twice.",
    ),
  saveAgain: z
    .boolean()
    .default(false)
    .describe(
      "Save another copy even though you already saved this address. Leave it false unless the user asked to save it again.",
    ),
});
export const shareLinkOutput = z.object({
  status: z.enum(["saved", "existing"]),
  link: linkSchema,
});
