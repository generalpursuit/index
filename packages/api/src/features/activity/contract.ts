import { baseContract, successSchema } from "../../shared/schemas";
import { activityInputSchema, activityPageSchema, readActivitiesSchema } from "./schemas";
export const activityContract = {
  list: baseContract
    .route({ method: "GET", path: "/me/activity", tags: ["Activity"] })
    .input(activityInputSchema)
    .output(activityPageSchema),
  markRead: baseContract
    .route({ method: "POST", path: "/me/activity/read", tags: ["Activity"] })
    .input(readActivitiesSchema)
    .output(successSchema),
};
