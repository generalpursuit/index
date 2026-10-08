import { optionalAuth } from "../../shared/schemas";
import { baseContract, idInputSchema, successSchema } from "../../shared/schemas";

import {
  createLinkInputSchema,
  getLinkInputSchema,
  linkSchema,
  listMyLinksInputSchema,
  listMyLinksOutputSchema,
  updateLinkInputSchema,
  listGroupLinksInputSchema,
} from "./schemas";

export const linksContract = {
  create: baseContract
    .route({
      method: "POST",
      path: "/links",
      successStatus: 201,
      summary: "Save a link to your inbox or an owned group",
      tags: ["Links"],
    })
    .input(createLinkInputSchema)
    .output(linkSchema),

  listMine: baseContract
    .route({
      method: "GET",
      path: "/links",
      summary: "List your saved links, newest first",
      tags: ["Links"],
    })
    .input(listMyLinksInputSchema)
    .output(listMyLinksOutputSchema),

  get: baseContract
    .route({
      spec: optionalAuth,
      method: "GET",
      path: "/links/{id}",
      summary: "Get a link visible to you",
      tags: ["Links"],
    })
    .errors({ NOT_FOUND: { message: "Link not found." } })
    .input(getLinkInputSchema)
    .output(linkSchema),
  update: baseContract
    .route({ method: "PATCH", path: "/links/{id}", tags: ["Links"] })
    .input(updateLinkInputSchema)
    .output(linkSchema),
  delete: baseContract
    .route({ method: "DELETE", path: "/links/{id}", tags: ["Links"] })
    .input(idInputSchema)
    .output(successSchema),
  listInGroup: baseContract
    .route({ spec: optionalAuth, method: "GET", path: "/groups/{groupId}/links", tags: ["Links"] })
    .input(listGroupLinksInputSchema)
    .output(listMyLinksOutputSchema),
};
