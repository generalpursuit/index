import { randomInt } from "node:crypto";
import { account, user } from "@index/db/schema/auth";
import { authChallenge } from "@index/db/schema/auth-security";
import { and, eq, sql } from "drizzle-orm";
import type { PgAsyncDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { z } from "zod";
import type { EmailTransport, SecurityEmail } from "./delivery";

type DB = Pick<PgAsyncDatabase<PgQueryResultHKT>, "select" | "update">;
type Identity = {
  user: { id: string; email: string; emailVerified: boolean };
  session: { id: string };
};
export type SecurityOptions = {
  sendEmail: EmailTransport;
  backgroundTask?: (task: Promise<unknown>) => void;
};
const emailSchema = z
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());
const passwordSchema = z.string().min(8).max(128);
const codeSchema = z.string().regex(/^\d{6}$/);
const invalidCode = () =>
  new APIError("BAD_REQUEST", {
    code: "INVALID_CODE",
    message: "That code is incorrect, expired, or already used. Request a new code if needed.",
  });
const limited = () =>
  new APIError("TOO_MANY_REQUESTS", {
    code: "TRY_LATER",
    message: "Too many attempts. Wait before trying again.",
    retryAfter: 60,
  });

export function securityService(db: DB, secret: string, options: SecurityOptions) {
  async function digest(value: string) {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  const challengeKey = (purpose: string, identity: string) =>
    digest(`challenge:${purpose}:${identity}`);
  async function limit(scope: string, max: number, seconds = 3600) {
    const key = await digest(`limit:${scope}`);
    const [result] = await db
      .select({ ok: sql<boolean>`index_auth_limit(${key},${max},${seconds})` })
      .from(sql`(select 1) as auth_op`);
    return result?.ok === true;
  }
  async function throttle(scope: string, max: number, seconds = 3600) {
    if (!(await limit(scope, max, seconds))) throw limited();
  }
  async function issue(
    purpose: SecurityEmail["purpose"],
    email: string,
    identity?: Identity,
    passwordHash?: string,
  ) {
    const found =
      purpose === "reset"
        ? (await db.select().from(user).where(eq(user.email, email)).limit(1))[0]
        : identity?.user;
    const key = await challengeKey(purpose, purpose === "reset" ? email : identity!.user.id);
    // Both real and unknown reset addresses take identical challenge/rate-limit paths.
    if (
      !(await limit(`send:${key}`, 1, 60)) ||
      !(await limit(`send-hour:${key}`, 5)) ||
      !(await limit(`recipient:${email}`, 10))
    ) {
      if (purpose === "reset") return { success: true as const, retryAfter: 60 };
      throw limited();
    }
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const nonce = crypto.randomUUID();
    const hash = await digest(`${key}:${nonce}:${code}`);
    const [result] = await db
      .select({
        ok: sql<boolean>`index_auth_issue(${key},${found?.id ?? null},${identity?.session.id ?? null},${purpose},${email},${found?.email ?? email},${nonce},${hash},${passwordHash ?? null})`,
      })
      .from(sql`(select 1) as auth_op`);
    if (!result?.ok) {
      if (purpose === "reset") return { success: true as const, retryAfter: 60 };
      throw limited();
    }
    const delivery = (async () => {
      try {
        if (found) await options.sendEmail({ to: email, code, purpose, id: nonce });
        await db
          .update(authChallenge)
          .set({ delivery: "sent" })
          .where(and(eq(authChallenge.key, key), eq(authChallenge.nonce, nonce)));
      } catch {
        await db
          .update(authChallenge)
          .set({ delivery: "failed" })
          .where(and(eq(authChallenge.key, key), eq(authChallenge.nonce, nonce)));
      }
    })();
    // Recovery never waits on a provider request (including failures). Worker waitUntil
    // keeps delivery alive after its uniform response; local tests inject a capture.
    if (purpose === "reset") {
      options.backgroundTask?.(delivery);
      void delivery.catch(() => {});
    } else {
      await delivery;
    }
    return { success: true as const, retryAfter: 60 };
  }
  async function status(identity: Identity, purpose: "verify" | "change-email" = "verify") {
    const key = await challengeKey(purpose, identity.user.id);
    const [row] = await db
      .select()
      .from(authChallenge)
      .where(and(eq(authChallenge.key, key), eq(authChallenge.sessionId, identity.session.id)))
      .limit(1);
    return {
      email: row?.email ?? identity.user.email,
      pending: !!row && !row.consumed,
      delivery: row?.delivery ?? "none",
      retryAfter: row
        ? Math.max(0, Math.ceil((row.sentAt.getTime() + 60_000 - Date.now()) / 1000))
        : 0,
      expiresAt: row?.expiresAt.toISOString() ?? null,
    };
  }
  async function consume(
    purpose: SecurityEmail["purpose"],
    identity: string,
    code: string,
    sessionId?: string,
    passwordHash?: string,
  ) {
    const key = await challengeKey(purpose, identity);
    await throttle(`guess:${key}`, 25);
    const [row] = await db
      .select({ nonce: authChallenge.nonce })
      .from(authChallenge)
      .where(eq(authChallenge.key, key))
      .limit(1);
    const hash = await digest(`${key}:${row?.nonce ?? "missing"}:${code}`);
    const [result] = await db
      .select({
        result: sql<string>`index_auth_consume(${key},${hash},${sessionId ?? null},${passwordHash ?? null})`,
      })
      .from(sql`(select 1) as auth_op`);
    if (result?.result === "unavailable")
      throw new APIError("CONFLICT", {
        message: "That address cannot be used. Choose another address.",
      });
    if (result?.result !== "ok") throw invalidCode();
    return { success: true };
  }
  return { digest, throttle, issue, status, consume };
}

export function securityPlugin(db: DB, security: ReturnType<typeof securityService>) {
  async function credential(userId: string) {
    return (
      await db
        .select()
        .from(account)
        .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
        .limit(1)
    )[0];
  }
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
        async (ctx) => {
          if (ctx.context.session.user.emailVerified)
            throw new APIError("BAD_REQUEST", { message: "Email is already verified." });
          // Resume a corrected address instead of silently switching back to the mistaken one.
          const status = await security.status(ctx.context.session);
          return security.issue("verify", status.email, ctx.context.session);
        },
      ),
      correctSignupEmail: createAuthEndpoint(
        "/security/correct-email",
        {
          method: "POST",
          body: z.object({ email: emailSchema, password: passwordSchema }),
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const identity = ctx.context.session;
          if (identity.user.emailVerified)
            throw new APIError("BAD_REQUEST", { message: "Use Change email in Settings." });
          await security.throttle(`password:${identity.user.id}`, 10);
          const found = await credential(identity.user.id);
          if (
            !found?.password ||
            !(await ctx.context.password.verify({
              hash: found.password,
              password: ctx.body.password,
            }))
          )
            throw new APIError("BAD_REQUEST", { message: "Current password is incorrect." });
          return security.issue("verify", ctx.body.email, identity, found.password);
        },
      ),
      verifySignupEmail: createAuthEndpoint(
        "/security/verify-email",
        { method: "POST", body: z.object({ code: codeSchema }), use: [sessionMiddleware] },
        async (ctx) =>
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
        async (ctx) => security.issue("reset", ctx.body.email),
      ),
      resetWithCode: createAuthEndpoint(
        "/security/reset-password",
        {
          method: "POST",
          body: z.object({ email: emailSchema, code: codeSchema, newPassword: passwordSchema }),
        },
        async (ctx) => {
          const hash = await ctx.context.password.hash(ctx.body.newPassword);
          return security.consume("reset", ctx.body.email, ctx.body.code, undefined, hash);
        },
      ),
      requestEmailChange: createAuthEndpoint(
        "/security/request-email-change",
        {
          method: "POST",
          body: z.object({ email: emailSchema, password: passwordSchema }),
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const identity = ctx.context.session;
          if (!identity.user.emailVerified)
            throw new APIError("FORBIDDEN", {
              code: "EMAIL_NOT_VERIFIED",
              message: "Verify your email first.",
            });
          await security.throttle(`password:${identity.user.id}`, 10);
          const found = await credential(identity.user.id);
          if (
            !found?.password ||
            !(await ctx.context.password.verify({
              hash: found.password,
              password: ctx.body.password,
            }))
          )
            throw new APIError("BAD_REQUEST", { message: "Current password is incorrect." });
          return security.issue("change-email", ctx.body.email, identity, found.password);
        },
      ),
      confirmEmailChange: createAuthEndpoint(
        "/security/confirm-email-change",
        { method: "POST", body: z.object({ code: codeSchema }), use: [sessionMiddleware] },
        async (ctx) =>
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
        async (ctx) => {
          const identity = ctx.context.session;
          if (!identity.user.emailVerified)
            throw new APIError("FORBIDDEN", {
              code: "EMAIL_NOT_VERIFIED",
              message: "Verify your email first.",
            });
          await security.throttle(`password:${identity.user.id}`, 10);
          const found = await credential(identity.user.id);
          if (
            !found?.password ||
            !(await ctx.context.password.verify({
              hash: found.password,
              password: ctx.body.currentPassword,
            }))
          )
            throw new APIError("BAD_REQUEST", { message: "Current password is incorrect." });
          const hash = await ctx.context.password.hash(ctx.body.newPassword);
          const [result] = await db
            .select({
              ok: sql<boolean>`index_auth_password(${identity.user.id},${identity.session.id},${found.password},${hash})`,
            })
            .from(sql`(select 1) as auth_op`);
          if (!result?.ok)
            throw new APIError("BAD_REQUEST", {
              message: "Your session changed. Sign in and try again.",
            });
          return { success: true };
        },
      ),
    },
  };
}
