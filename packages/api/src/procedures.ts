import { getOpenAPIMeta } from "@orpc/openapi";
import { ORPCError, os } from "@orpc/server";
import type { Result } from "neverthrow";

import { getAgentTool } from "./agent-tools";
import type { Caller, Context } from "./context";
import type { ApplicationError } from "./errors";

// A restricted session (signed in, email unverified) never acts. An agent's account is always
// verified: `verifyMcpAccess` accepts no token of an unverified account.
const restricted = (caller: Caller | null) =>
  caller?.kind === "session" && !caller.session.user.emailVerified;

const verifyEmail = () =>
  new ORPCError("FORBIDDEN", {
    message: "Verify your email to continue.",
    data: { code: "EMAIL_NOT_VERIFIED" },
  });

/** Public reads remain anonymous, but restricted sessions never become a viewer. */
export const requireVerifiedSession = os
  .$context<Context>()
  .middleware(async ({ context, next }) => {
    if (restricted(context.caller)) throw verifyEmail();
    return next();
  });

function authenticated({ caller }: Context) {
  if (!caller) throw new ORPCError("UNAUTHORIZED", { message: "Sign in to continue." });
  if (restricted(caller)) throw verifyEmail();
  return caller;
}

export const requireAuth = os.$context<Context>().middleware(async ({ context, next }) => {
  const caller = authenticated(context);
  return next({ context: { caller, actorId: caller.userId } });
});

/** For procedures bound to the browser or device session itself, which agents don't have. */
export const requireSession = os.$context<Context>().middleware(async ({ context, next }) => {
  const caller = authenticated(context);
  if (caller.kind !== "session")
    throw new ORPCError("FORBIDDEN", { message: "Only a signed-in session can do this." });
  return next({ context: { caller, session: caller.session, actorId: caller.userId } });
});

/**
 * Agents call only procedures marked as agent tools, and only within their grant; writing
 * implies reading. Sessions are unaffected. The check runs inside the procedure, whichever
 * transport delivered the call.
 */
export const authorizeAgent = os
  .$context<Context>()
  .middleware(async ({ context, procedure, next }) => {
    if (context.caller?.kind !== "agent") return next();
    const tool = getAgentTool(procedure);
    if (!tool) throw new ORPCError("FORBIDDEN", { message: "Connected apps can't do this." });
    if (!context.caller.permissions.includes(tool.permission))
      throw new ORPCError("FORBIDDEN", {
        message: "This connection can only read. Connect the app again with write access.",
      });
    return next();
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
      !context.caller ||
      restricted(context.caller) ||
      getOpenAPIMeta(procedure)?.method === "GET" ||
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
