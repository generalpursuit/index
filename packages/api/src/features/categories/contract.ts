import { baseContract } from "../../shared/schemas";
import { suggestCategoryInputSchema, suggestedCategorySchema } from "./schemas";

export const categoriesContract = {
  suggest: baseContract
    .route({ method: "POST", path: "/categories/suggest", tags: ["Categories"] })
    .input(suggestCategoryInputSchema)
    .output(suggestedCategorySchema),
};
