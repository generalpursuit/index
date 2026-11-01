import { openapi } from "@orpc/openapi";
import { agentTool } from "../../agent-tools";
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
        summary: "Comment on a link",
        description:
          "Posts a plain-text comment on a link the signed-in user may see. Everyone who can see the link can read it, and its owner and anyone mentioned as @username are notified. Post only what the user asked you to post. It cannot edit or delete comments.",
      }),
      agentTool({ name: "post_comment", permission: "write" }),
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
        summary: "List a link's comments, newest first",
        description:
          "Lists the comments on one link, newest first, each with its author's public identity. A link the signed-in user may not see returns not found, exactly like a missing one.",
      }),
      agentTool({ name: "list_comments", permission: "read" }),
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
