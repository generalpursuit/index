import { openapi } from "@orpc/openapi";
import { baseContract, successSchema } from "../../shared/schemas";
import { activityInputSchema, activityPageSchema, readActivitiesSchema } from "./schemas";
export const activityContract = {
  list: baseContract
    .meta(openapi({ method: "GET", path: "/me/activity", tags: ["Activity"] }))
    .input(activityInputSchema)
    .output(activityPageSchema),
  markRead: baseContract
    .meta(openapi({ method: "POST", path: "/me/activity/read", tags: ["Activity"] }))
    .input(readActivitiesSchema)
    .output(successSchema),
};
