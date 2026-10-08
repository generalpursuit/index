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
    .route({
      method: "POST",
      path: "/links/{linkId}/comments",
      successStatus: 201,
      tags: ["Comments"],
    })
    .input(createCommentSchema)
    .output(commentSchema),
  list: baseContract
    .route({
      spec: optionalAuth,
      method: "GET",
      path: "/links/{linkId}/comments",
      tags: ["Comments"],
    })
    .input(listCommentsSchema)
    .output(commentPageSchema),
  update: baseContract
    .route({ method: "PATCH", path: "/comments/{id}", tags: ["Comments"] })
    .input(updateCommentSchema)
    .output(commentSchema),
  delete: baseContract
    .route({ method: "DELETE", path: "/comments/{id}", tags: ["Comments"] })
    .input(idInputSchema)
    .output(successSchema),
};
