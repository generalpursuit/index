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
    .route({ spec: optionalAuth, method: "GET", path: "/discovery/users", tags: ["Discovery"] })
    .input(searchUsersSchema)
    .output(discoveredUserPageSchema),
  recommendations: baseContract
    .route({ method: "GET", path: "/discovery/recommendations", tags: ["Discovery"] })
    .input(recommendationsInputSchema)
    .output(recommendationsSchema),
};
