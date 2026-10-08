import { baseContract, pageInputSchema } from "../../shared/schemas";
import { feedPageSchema } from "./schemas";

export const feedContract = {
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
