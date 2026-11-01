import { openapi } from "@orpc/openapi";
import { z } from "zod";
import { baseContract } from "../../shared/schemas";

export const liveContract = {
  ticket: baseContract
    .meta(openapi({ method: "POST", path: "/me/live/ticket", tags: ["System"] }))
    .input(z.strictObject({}).optional())
    .output(z.object({ url: z.string().url() })),
};
