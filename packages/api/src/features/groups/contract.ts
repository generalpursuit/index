import { openapi } from "@orpc/openapi";
import { optionalAuth } from "../../shared/schemas";
import { baseContract, idInputSchema, successSchema } from "../../shared/schemas";
import {
  createGroupSchema,
  deleteGroupSchema,
  groupPageSchema,
  groupSchema,
  listGroupsSchema,
  updateGroupSchema,
} from "./schemas";

export const groupsContract = {
  create: baseContract
    .meta(openapi({ method: "POST", path: "/groups", successStatus: 201, tags: ["Groups"] }))
    .input(createGroupSchema)
    .output(groupSchema),
  list: baseContract
    .meta(openapi({ spec: optionalAuth, method: "GET", path: "/groups", tags: ["Groups"] }))
    .input(listGroupsSchema)
    .output(groupPageSchema),
  get: baseContract
    .meta(openapi({ spec: optionalAuth, method: "GET", path: "/groups/{id}", tags: ["Groups"] }))
    .input(idInputSchema)
    .output(groupSchema),
  update: baseContract
    .meta(openapi({ method: "PATCH", path: "/groups/{id}", tags: ["Groups"] }))
    .input(updateGroupSchema)
    .output(groupSchema),
  delete: baseContract
    .meta(openapi({ method: "DELETE", path: "/groups/{id}", tags: ["Groups"] }))
    .input(deleteGroupSchema)
    .output(successSchema),
};
