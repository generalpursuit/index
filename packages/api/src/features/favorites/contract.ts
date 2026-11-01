import { openapi } from "@orpc/openapi";
import { z } from "zod";
import { baseContract, pageInputSchema, successSchema } from "../../shared/schemas";
import { groupSchema } from "../groups/schemas";
import { listMyLinksOutputSchema } from "../links/schemas";

const targetSchema = z.strictObject({ linkId: z.uuid() });
export const favoritesContract = {
  add: baseContract
    .meta(openapi({ method: "PUT", path: "/links/{linkId}/favorite", tags: ["Favorites"] }))
    .input(targetSchema)
    .output(successSchema),
  remove: baseContract
    .meta(openapi({ method: "DELETE", path: "/links/{linkId}/favorite", tags: ["Favorites"] }))
    .input(targetSchema)
    .output(successSchema),
  group: baseContract
    .meta(openapi({ method: "GET", path: "/me/favorites/group", tags: ["Favorites"] }))
    .input(z.strictObject({}).optional())
    .output(groupSchema),
  list: baseContract
    .meta(openapi({ method: "GET", path: "/me/favorites", tags: ["Favorites"] }))
    .input(pageInputSchema)
    .output(listMyLinksOutputSchema),
};
