import { openapi } from "@orpc/openapi";
import { agentTool } from "../../agent-tools";
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
  searchLinksInputSchema,
} from "./schemas";

export const linksContract = {
  share: baseContract
    .meta(
      openapi({
        method: "POST",
        path: "/links/share",
        tags: ["Links"],
        summary: "Save into this week with duplicate detection and safe retries",
        description:
          "Saves a web address into the signed-in user's links for the current UTC week, in Your links or one of their groups. Index reads the page's title and kind itself. When they already saved the same address (compared exactly after trimming, in any group or week), nothing new is saved and the existing link returns with status `existing`: tell the user instead of saving again. It cannot edit, move or delete links or save into another person's group.",
      }),
      agentTool({ name: "save_link", permission: "write" }),
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
        summary: "List a person's saved links, newest first",
        description:
          "Lists the links one person saved that the signed-in user may see, newest first: all of them on a public profile, on a private profile only for accepted followers, and never those in the person's locked groups. When none are visible the list is empty. To find their links by words, search links with their user ID.",
      }),
      agentTool({ name: "list_person_links", permission: "read" }),
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
        description:
          "Lists the signed-in user's own saved links, newest first, optionally only one week, group or kind. To find links by words in their title, address or note, search links instead.",
        tags: ["Links"],
      }),
      agentTool({ name: "list_my_links", permission: "read" }),
    )
    .input(listMyLinksInputSchema)
    .output(listMyLinksOutputSchema),

  search: baseContract
    .meta(
      openapi({
        method: "GET",
        path: "/links/search",
        summary: "Search saved links by words, newest first",
        description:
          "Finds the signed-in user's saved links whose title, address or note contains every word of the query, ignoring case, newest first. With a person's user ID it searches that person's links instead, among only those their list shows the user: none of a private profile's unless the user is an accepted follower, and never those in locked groups. It does not search the web, comments or messages.",
        tags: ["Links"],
      }),
      agentTool({ name: "search_links", permission: "read" }),
    )
    .input(searchLinksInputSchema)
    .output(listMyLinksOutputSchema),

  get: baseContract
    .meta(
      openapi({
        spec: optionalAuth,
        method: "GET",
        path: "/links/{id}",
        summary: "Get a link visible to you",
        description:
          "Returns one saved link by ID: its address, title, note, kind, save date and owner's user ID. Links the signed-in user may not see return not found, exactly like missing ones. Comments are listed separately.",
        tags: ["Links"],
      }),
      agentTool({ name: "get_link", permission: "read" }),
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
        summary: "List the links in a group, newest first",
        description:
          "Lists the links in one group that the signed-in user may see, newest saved first, each with its owner's name. Works for a person's groups and for the user's own Starred (other people's links) and Favorites collections. Locked groups open only for their owner; groups the user may not open return not found, exactly like missing ones. Get a group's ID by resolving its Index address.",
      }),
      agentTool({ name: "list_group_links", permission: "read" }),
    )
    .input(listGroupLinksInputSchema)
    .output(listGroupLinksOutputSchema),
};
