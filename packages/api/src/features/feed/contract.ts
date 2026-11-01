import { openapi } from "@orpc/openapi";
import { agentTool } from "../../agent-tools";
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
    .meta(openapi({ method: "GET", path: "/feed/week", tags: ["Feed"] }))
    .input(weekFeedInputSchema)
    .output(weekFeedSchema),
  weeks: baseContract
    .meta(
      openapi({
        method: "GET",
        path: "/feed/weeks",
        tags: ["Feed"],
        summary: "Weeks with links from you or people you follow, newest first",
      }),
    )
    .input(feedWeeksInputSchema)
    .output(libraryWeeksSchema),
  list: baseContract
    .meta(
      openapi({
        method: "GET",
        path: "/feed",
        tags: ["Feed"],
        summary: "Newest visible links saved by people you follow",
        description:
          "Lists the links saved by people the signed-in user follows (accepted follows only), newest first, each with its author. It leaves out the user's own links and anything those people may not show them, such as links in locked groups.",
      }),
      agentTool({ name: "list_following_feed", permission: "read" }),
    )
    .input(pageInputSchema)
    .output(feedPageSchema),
};
