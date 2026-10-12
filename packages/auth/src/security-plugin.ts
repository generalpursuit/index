import { createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { z } from "zod";
import type { securityService } from "./security";

const emailSchema = z
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());
const passwordSchema = z.string().min(8).max(128);
const codeSchema = z.string().regex(/^\d{6}$/);

/** Better Auth owns HTTP validation and sessions; security owns account operations. */
export function securityPlugin(security: ReturnType<typeof securityService>) {
  return {
    id: "index-security",
    endpoints: {
      securityStatus: createAuthEndpoint(
        "/security/status",
        { method: "GET", use: [sessionMiddleware] },
        async (ctx) => ({
          verification: await security.status(ctx.context.session),
          emailChange: await security.status(ctx.context.session, "change-email"),
        }),
      ),
      sendVerificationCode: createAuthEndpoint(
        "/security/send-verification",
        { method: "POST", body: z.object({}), use: [sessionMiddleware] },
        (ctx) => security.resendVerification(ctx.context.session),
      ),
      correctSignupEmail: createAuthEndpoint(
        "/security/correct-email",
        {
          method: "POST",
          body: z.object({ email: emailSchema, password: passwordSchema }),
          use: [sessionMiddleware],
        },
        (ctx) =>
          security.correctEmail(
            ctx.context.session,
            ctx.body.email,
            ctx.body.password,
            ctx.context.password,
          ),
      ),
      verifySignupEmail: createAuthEndpoint(
        "/security/verify-email",
        { method: "POST", body: z.object({ code: codeSchema }), use: [sessionMiddleware] },
        (ctx) =>
          security.consume(
            "verify",
            ctx.context.session.user.id,
            ctx.body.code,
            ctx.context.session.session.id,
          ),
      ),
      requestRecovery: createAuthEndpoint(
        "/security/request-reset",
        { method: "POST", body: z.object({ email: emailSchema }) },
        (ctx) => security.issue("reset", ctx.body.email),
      ),
      resetWithCode: createAuthEndpoint(
        "/security/reset-password",
        {
          method: "POST",
          body: z.object({ email: emailSchema, code: codeSchema, newPassword: passwordSchema }),
        },
        (ctx) =>
          security.resetPassword(
            ctx.body.email,
            ctx.body.code,
            ctx.body.newPassword,
            ctx.context.password,
          ),
      ),
      requestEmailChange: createAuthEndpoint(
        "/security/request-email-change",
        {
          method: "POST",
          body: z.object({ email: emailSchema, password: passwordSchema }),
          use: [sessionMiddleware],
        },
        (ctx) =>
          security.requestEmailChange(
            ctx.context.session,
            ctx.body.email,
            ctx.body.password,
            ctx.context.password,
          ),
      ),
      confirmEmailChange: createAuthEndpoint(
        "/security/confirm-email-change",
        { method: "POST", body: z.object({ code: codeSchema }), use: [sessionMiddleware] },
        (ctx) =>
          security.consume(
            "change-email",
            ctx.context.session.user.id,
            ctx.body.code,
            ctx.context.session.session.id,
          ),
      ),
      changeAccountPassword: createAuthEndpoint(
        "/security/change-password",
        {
          method: "POST",
          body: z.object({ currentPassword: passwordSchema, newPassword: passwordSchema }),
          use: [sessionMiddleware],
        },
        (ctx) =>
          security.changePassword(
            ctx.context.session,
            ctx.body.currentPassword,
            ctx.body.newPassword,
            ctx.context.password,
          ),
      ),
    },
  };
}
