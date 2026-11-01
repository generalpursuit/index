import { openapi } from "@orpc/openapi";
import { optionalAuth } from "../../shared/schemas";
import { baseContract, idInputSchema, successSchema } from "../../shared/schemas";
import {
  commentPageSchema,
  commentSchema,
  createCommentSchema,
  listCommentsSchema,
  updateCommentSchema,
} from "./schemas";

export const commentsContract = {
  create: baseContract
    .meta(
      openapi({
        method: "POST",
        path: "/links/{linkId}/comments",
        successStatus: 201,
        tags: ["Comments"],
      }),
    )
    .input(createCommentSchema)
    .output(commentSchema),
  list: baseContract
    .meta(
      openapi({
        spec: optionalAuth,
        method: "GET",
        path: "/links/{linkId}/comments",
        tags: ["Comments"],
      }),
    )
    .input(listCommentsSchema)
    .output(commentPageSchema),
  update: baseContract
    .meta(openapi({ method: "PATCH", path: "/comments/{id}", tags: ["Comments"] }))
    .input(updateCommentSchema)
    .output(commentSchema),
  delete: baseContract
    .meta(openapi({ method: "DELETE", path: "/comments/{id}", tags: ["Comments"] }))
    .input(idInputSchema)
    .output(successSchema),
};
