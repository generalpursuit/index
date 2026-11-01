import { openapi } from "@orpc/openapi";
import { agentTool } from "../../agent-tools";
import { optionalAuth } from "../../shared/schemas";
import { baseContract } from "../../shared/schemas";
import {
  discoveredUserPageSchema,
  recommendationsInputSchema,
  recommendationsSchema,
  searchUsersSchema,
} from "./schemas";

export const discoveryContract = {
  searchUsers: baseContract
    .meta(
      openapi({
        spec: optionalAuth,
        method: "GET",
        path: "/discovery/users",
        tags: ["Discovery"],
        summary: "Find people by name or username",
        description:
          "Searches people whose name or username contains the query, ignoring case, and says whether the signed-in user follows each and who they follow that follows them too. When several people match and the user's words don't single one out, ask the user which person they mean instead of guessing. Finding a person does not reveal their links: a private profile shows them only to accepted followers.",
      }),
      agentTool({ name: "find_people", permission: "read" }),
    )
    .input(searchUsersSchema)
    .output(discoveredUserPageSchema),
  recommendations: baseContract
    .meta(openapi({ method: "GET", path: "/discovery/recommendations", tags: ["Discovery"] }))
    .input(recommendationsInputSchema)
    .output(recommendationsSchema),
};
