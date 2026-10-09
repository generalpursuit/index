import { baseContract, pageInputSchema } from "../../shared/schemas";
import { libraryWeeksSchema } from "../links/schemas";
import {
  feedPageSchema,
  feedWeeksInputSchema,
  weekFeedInputSchema,
  weekFeedSchema,
} from "./schemas";

export const feedContract = {
  week: baseContract
    .route({ method: "GET", path: "/feed/week", tags: ["Feed"] })
    .input(weekFeedInputSchema)
    .output(weekFeedSchema),
  weeks: baseContract
    .route({
      method: "GET",
      path: "/feed/weeks",
      tags: ["Feed"],
      summary: "Weeks with links from you or people you follow, newest first",
    })
    .input(feedWeeksInputSchema)
    .output(libraryWeeksSchema),
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
