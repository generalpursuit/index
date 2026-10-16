import { linkOptions } from "@tanstack/react-router";
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
/**
 * Opens or closes those modals. They open over the page, which stays where it was scrolled;
 * like any navigation, changing them would otherwise return it to the top.
 */
export const modalNavigation = (change: { post?: string; edit?: string }) =>
  linkOptions({ to: ".", search: (old) => ({ ...old, ...change }), resetScroll: false });
export const weekSearch = z.iso
  .date()
  .refine((v) => !v.startsWith("0000-") && v <= monday())
  .transform((v) => monday(new Date(v + "T00:00:00Z")))
  .optional()
  .catch(undefined);
