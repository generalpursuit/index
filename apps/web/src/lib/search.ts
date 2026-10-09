import { z } from "zod";
import { monday } from "./weeks";
// Modals that open over any page: a post, the link composer (`add` is `true` or a group
// to preselect) and editing a link.
export const appSearch = z.object({
  post: z.uuid().optional().catch(undefined),
  add: z
    .union([z.literal(true), z.uuid()])
    .optional()
    .catch(undefined),
  edit: z.uuid().optional().catch(undefined),
});
export const weekSearch = z.iso
  .date()
  .refine((v) => !v.startsWith("0000-") && v <= monday())
  .transform((v) => monday(new Date(v + "T00:00:00Z")))
  .optional()
  .catch(undefined);
