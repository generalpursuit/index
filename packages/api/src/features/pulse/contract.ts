import { z } from "zod";
import { baseContract } from "../../shared/schemas";

const listPulseSchema = z.object({
  unreadCount: z.number().int().nonnegative(),
  version: z.string(),
});

export const pulseContract = {
  get: baseContract
    .route({ method: "GET", path: "/me/pulse", tags: ["System"] })
    .input(z.strictObject({}).optional())
    .output(z.object({ messages: listPulseSchema, activity: listPulseSchema })),
};
