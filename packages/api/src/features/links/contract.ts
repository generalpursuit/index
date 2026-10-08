import { oc } from "@orpc/contract";

import {
  createLinkInputSchema,
  getLinkInputSchema,
  linkSchema,
  listMyLinksInputSchema,
  listMyLinksOutputSchema,
} from "./schemas";

const authenticated = oc.errors({
  UNAUTHORIZED: { message: "Sign in to continue." },
  BAD_REQUEST: { message: "Invalid input." },
  INTERNAL_SERVER_ERROR: { message: "Something went wrong." },
});

export const linksContract = {
  create: authenticated
    .route({
      method: "POST",
      path: "/links",
      successStatus: 201,
      summary: "Save a link to your private inbox",
      tags: ["Links"],
    })
    .input(createLinkInputSchema)
    .output(linkSchema),

  listMine: authenticated
    .route({
      method: "GET",
      path: "/links",
      summary: "List your saved links, newest first",
      tags: ["Links"],
    })
    .input(listMyLinksInputSchema)
    .output(listMyLinksOutputSchema),

  get: authenticated
    .route({
      method: "GET",
      path: "/links/{id}",
      summary: "Get one of your saved links",
      tags: ["Links"],
    })
    .errors({ NOT_FOUND: { message: "Link not found." } })
    .input(getLinkInputSchema)
    .output(linkSchema),
};
