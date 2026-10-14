import { baseContract } from "../../shared/schemas";
import { importCurateeInputSchema, importCurateeOutputSchema } from "./schemas";

export const importsContract = {
  curatee: baseContract
    .route({
      method: "POST",
      path: "/imports/curatee",
      tags: ["Imports"],
      summary: "Import a curatee.co profile's links into Your links, on the days they were saved",
    })
    .errors({
      NOT_FOUND: { message: "No curatee profile has that username." },
      BAD_GATEWAY: { message: "curatee.co can't be reached right now. Try again later." },
    })
    .input(importCurateeInputSchema)
    .output(importCurateeOutputSchema),
};
