import { z } from "zod";
import { monday } from "./weeks";
// Modals that open over any page: a post and editing a link.
export const appSearch = z.object({
  post: z
    .string()
    .regex(/^(?:[A-Za-z0-9_-]{16}|[0-9a-f-]{36})$/)
    .optional()
    .catch(undefined),
  edit: z
    .string()
    .regex(/^(?:[A-Za-z0-9_-]{16}|[0-9a-f-]{36})$/)
    .optional()
    .catch(undefined),
});
export const weekSearch = z.iso
  .date()
  .refine((v) => !v.startsWith("0000-") && v <= monday())
  .transform((v) => monday(new Date(v + "T00:00:00Z")))
  .optional()
  .catch(undefined);
