import { openapi } from "@orpc/openapi";
import { listOwnerLinksSchema, libraryWeeksInputSchema, libraryWeeksSchema } from "./schemas";
import { optionalAuth } from "../../shared/schemas";
import { shareLinkInput, shareLinkOutput } from "./sharing-schemas";
import { baseContract, idInputSchema, successSchema } from "../../shared/schemas";

import {
  createLinkInputSchema,
  getLinkInputSchema,
  linkSchema,
  listMyLinksInputSchema,
  listMyLinksOutputSchema,
  updateLinkInputSchema,
  listGroupLinksInputSchema,
  listGroupLinksOutputSchema,
} from "./schemas";

export const linksContract = {
  share: baseContract
    .meta(
      openapi({
        method: "POST",
        path: "/links/share",
        tags: ["Links"],
        summary: "Save into this week with duplicate detection and safe retries",
      }),
    )
    .input(shareLinkInput)
    .output(shareLinkOutput),
  weeks: baseContract
    .meta(
      openapi({
        method: "GET",
        path: "/profiles/{userId}/weeks",
        tags: ["Links"],
        spec: optionalAuth,
      }),
    )
    .input(libraryWeeksInputSchema)
    .output(libraryWeeksSchema),
  listByOwner: baseContract
    .meta(
      openapi({
        method: "GET",
        path: "/profiles/{userId}/links",
        spec: optionalAuth,
        tags: ["Links"],
      }),
    )
    .input(listOwnerLinksSchema)
    .output(listMyLinksOutputSchema),
  create: baseContract
    .meta(
      openapi({
        method: "POST",
        path: "/links",
        successStatus: 201,
        summary: "Save a link, optionally into one of your groups",
        tags: ["Links"],
      }),
    )
    .input(createLinkInputSchema)
    .output(linkSchema),

  listMine: baseContract
    .meta(
      openapi({
        method: "GET",
        path: "/links",
        summary: "List your saved links, newest first",
        tags: ["Links"],
      }),
    )
    .input(listMyLinksInputSchema)
    .output(listMyLinksOutputSchema),

  get: baseContract
    .meta(
      openapi({
        spec: optionalAuth,
        method: "GET",
        path: "/links/{id}",
        summary: "Get a link visible to you",
        tags: ["Links"],
      }),
    )
    .errors({ NOT_FOUND: { message: "Link not found." } })
    .input(getLinkInputSchema)
    .output(linkSchema),
  update: baseContract
    .meta(openapi({ method: "PATCH", path: "/links/{id}", tags: ["Links"] }))
    .input(updateLinkInputSchema)
    .output(linkSchema),
  delete: baseContract
    .meta(openapi({ method: "DELETE", path: "/links/{id}", tags: ["Links"] }))
    .input(idInputSchema)
    .output(successSchema),
  listInGroup: baseContract
    .meta(
      openapi({
        spec: optionalAuth,
        method: "GET",
        path: "/groups/{groupId}/links",
        tags: ["Links"],
      }),
    )
    .input(listGroupLinksInputSchema)
    .output(listGroupLinksOutputSchema),
};
