import { baseContract, pageInputSchema } from "../../shared/schemas";
import { feedPageSchema, weekFeedInputSchema, weekFeedSchema } from "./schemas";

export const feedContract = {
  week: baseContract
    .route({ method: "GET", path: "/feed/week", tags: ["Feed"] })
    .input(weekFeedInputSchema)
    .output(weekFeedSchema),
  list: baseContract
    .route({
      method: "GET",
      path: "/feed",
      tags: ["Feed"],
      summary: "Newest visible links saved by people you follow",
    })
    .input(pageInputSchema)
    .output(feedPageSchema),
};
