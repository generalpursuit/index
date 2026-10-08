import { z } from "zod";
import { httpUrlSchema } from "../../shared/schemas";
import { linkCategorySchema } from "../links/schemas";

export const suggestCategoryInputSchema = z.strictObject({ url: httpUrlSchema });
export const suggestedCategorySchema = z.object({
  category: linkCategorySchema,
  matched: z.boolean(),
});
