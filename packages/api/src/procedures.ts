import { ORPCError, os } from "@orpc/server";
import type { Result } from "neverthrow";

import type { Context } from "./context";
import type { ApplicationError } from "./errors";

/** Public reads remain anonymous, but restricted sessions never become a viewer. */
export const requireVerifiedSession = os
  .$context<Context>()
  .middleware(async ({ context, next }) => {
    if (context.session && !context.session.user.emailVerified) {
      throw new ORPCError("FORBIDDEN", {
        message: "Verify your email to continue.",
        data: { code: "EMAIL_NOT_VERIFIED" },
      });
    }
    return next();
  });

export const requireAuth = os.$context<Context>().middleware(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED", { message: "Sign in to continue." });
  }
  if (!context.session.user.emailVerified)
    throw new ORPCError("FORBIDDEN", {
      message: "Verify your email to continue.",
      data: { code: "EMAIL_NOT_VERIFIED" },
    });
  return next({
    context: { session: context.session, actorId: context.session.user.id },
  });
});

/** Contract methods classify operations even when RPC transports reads with HTTP POST. */
export const scheduleMutation = os
  .$context<Context>()
  .middleware(async ({ context, procedure, path, next }) => {
    const housekeeping =
      path[0] === "live" ||
      (path[0] === "notifications" && ["active", "poll", "ack", "resolve"].includes(path[1] ?? ""));
    if (
      !context.dispatch ||
      !context.session?.user.emailVerified ||
      procedure["~orpc"].route.method === "GET" ||
      housekeeping
    )
      return next();
    const complete = await context.dispatch();
    try {
      return await next();
    } finally {
      complete();
    }
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
