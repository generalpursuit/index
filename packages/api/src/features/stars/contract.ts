import { z } from "zod";
import { baseContract, pageInputSchema, successSchema } from "../../shared/schemas";
import { groupSchema } from "../groups/schemas";
import { listMyLinksOutputSchema } from "../links/schemas";

const targetSchema = z.strictObject({ linkId: z.uuid() });
export const starsContract = {
  add: baseContract
    .route({ method: "PUT", path: "/links/{linkId}/star", tags: ["Stars"] })
    .input(targetSchema)
    .output(successSchema),
  remove: baseContract
    .route({ method: "DELETE", path: "/links/{linkId}/star", tags: ["Stars"] })
    .input(targetSchema)
    .output(successSchema),
  group: baseContract
    .route({ method: "GET", path: "/me/starred/group", tags: ["Stars"] })
    .input(z.strictObject({}).optional())
    .output(groupSchema),
  list: baseContract
    .route({ method: "GET", path: "/me/starred", tags: ["Stars"] })
    .input(pageInputSchema)
    .output(listMyLinksOutputSchema),
};
