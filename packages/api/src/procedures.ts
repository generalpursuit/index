import { ORPCError, os } from "@orpc/server";
import type { Result } from "neverthrow";

import type { Context } from "./context";
import type { ApplicationError } from "./errors";

export const requireAuth = os.$context<Context>().middleware(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED", { message: "Sign in to continue." });
  }
  return next({
    context: { session: context.session, actorId: context.session.user.id },
  });
});

export function unwrapResult<T>(result: Result<T, ApplicationError>): T {
  return result.match(
    (value) => value,
    (error) => {
      throw new ORPCError(error.code, {
        message: error.message,
        cause: "cause" in error ? error.cause : undefined,
      });
    },
  );
}
