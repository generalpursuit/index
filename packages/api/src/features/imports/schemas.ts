import { z } from "zod";

export const importCurateeInputSchema = z.strictObject({
  // As in curatee.co/u/<username>.
  username: z
    .string()
    .trim()
    .min(1, "Enter a curatee username.")
    .max(64)
    .regex(/^[A-Za-z0-9_.-]+$/, "Enter a curatee username."),
});

export const importCurateeOutputSchema = z.object({
  /** Links saved by this import. Links imported before, even if deleted since, are skipped. */
  imported: z.number().int().nonnegative(),
});
