import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import type { relations } from "@index/db/relations";
import * as schema from "@index/db/schema/auth";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { bearer, openAPI, username } from "better-auth/plugins";
import type { PgAsyncDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { securityPlugin, securityService, type SecurityOptions } from "./security";
import { resendTransport } from "./delivery";
import { trustedWebOrigins } from "./origins";
import { usernameSchema } from "./username";

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  CORS_ORIGIN: string;
  AUTH_TRUSTED_ORIGINS?: string;
  AUTH_EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
};

export function createAuth<TQueryResult extends PgQueryResultHKT>(
  env: AuthConfig,
  database: PgAsyncDatabase<TQueryResult, typeof relations>,
  desktopOrigins: readonly string[] = [],
  securityOptions: Partial<SecurityOptions> = {},
) {
  const security = securityService(database, env.BETTER_AUTH_SECRET, {
    sendEmail: securityOptions.sendEmail ?? resendTransport(env),
    backgroundTask: securityOptions.backgroundTask,
  });
  const origins = [
    ...trustedWebOrigins(env.CORS_ORIGIN, env.AUTH_TRUSTED_ORIGINS),
    ...desktopOrigins,
  ];
  return betterAuth({
    database: drizzleAdapter(database, {
      provider: "pg",
      schema,
    }),
    trustedOrigins: origins,
    // Password authentication issues a restricted session until the application gate
    // sees fresh emailVerified=true. No email OTP/passwordless plugin is installed.
    emailAndPassword: { enabled: true, revokeSessionsOnPasswordReset: true },
    session: { cookieCache: { enabled: false } },
    rateLimit: { enabled: false }, // Shared PostgreSQL limits below work across Worker isolates.
    logger: { disabled: true },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
        httpOnly: true,
      },
    },
    hooks: {
      // The username plugin validates a supplied username; every new account must supply one.
      before: createAuthMiddleware(async (ctx) => {
        const origin = ctx.request?.headers.get("origin");
        if (origin && !origins.includes(origin))
          throw new APIError("FORBIDDEN", { message: "Untrusted origin." });
        const allowed = new Set([
          "/sign-up/email",
          "/sign-in/email",
          "/sign-in/username",
          "/get-session",
          "/sign-out",
          "/is-username-available",
          "/open-api/generate-schema",
          "/update-user",
        ]);
        if (!allowed.has(ctx.path) && !ctx.path.startsWith("/security/")) {
          throw new APIError("NOT_FOUND", { message: "Use the Index account security flow." });
        }
        if (ctx.path === "/update-user") {
          const session = await getSessionFromCtx(ctx);
          if (!session?.user.emailVerified)
            throw new APIError("FORBIDDEN", {
              code: "EMAIL_NOT_VERIFIED",
              message: "Verify your email to continue.",
            });
          // Account identity is changed only through the profile/namespace contract.
          throw new APIError("BAD_REQUEST", { message: "Edit your profile in Settings." });
        }
        if (ctx.method === "POST" && ctx.path !== "/sign-out") {
          // CF supplies this header at its edge. Never trust arbitrary X-Forwarded-For.
          const ip = ctx.request?.headers.get("cf-connecting-ip") ?? "local";
          await security.throttle(`ip:${ip}`, 120, 600);
          if (ctx.path.startsWith("/sign-in/")) {
            const identifier = String(ctx.body?.email ?? ctx.body?.username ?? "")
              .trim()
              .toLowerCase();
            await security.throttle(`login:${identifier}`, 20, 600);
          }
          if (ctx.path === "/sign-up/email" || ctx.path === "/security/request-reset")
            await security.throttle(`delivery-ip:${ip}`, 30);
        }
        if (ctx.path === "/sign-up/email" && typeof ctx.body?.username !== "string") {
          throw new APIError("BAD_REQUEST", { message: "Choose a username." });
        }
        // Photos are only ever uploaded through the app's API, never set as an address.
        if (
          (ctx.path === "/sign-up/email" || ctx.path === "/update-user") &&
          ctx.body?.image !== undefined
        ) {
          throw new APIError("BAD_REQUEST", { message: "Upload a photo in Settings instead." });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const created = ctx.context.newSession;
        if (ctx.path === "/sign-up/email" && created) {
          // A delivery failure must not hide a successful signup or lose its signed
          // session. The status endpoint gives the verification screen a safe retry.
          await security.issue("verify", created.user.email, created).catch(() => {});
        }
        if (ctx.path.startsWith("/sign-in/") && created) {
          // Close the login-versus-reset race: an old-password login which creates
          // its session after reset revocation must not leave a usable session.
          const credential = await ctx.context.internalAdapter.findCredentialAccount(
            created.user.id,
          );
          if (
            !credential?.password ||
            !(await ctx.context.password.verify({
              hash: credential.password,
              password: ctx.body.password,
            }))
          ) {
            await ctx.context.internalAdapter.deleteSession(created.session.token);
            throw new APIError("UNAUTHORIZED", { message: "Credentials changed. Sign in again." });
          }
        }
      }),
    },
    plugins: [
      bearer({ requireSignature: true }),
      securityPlugin(database, security),
      openAPI({ disableDefaultReference: true }),
      username({
        displayUsername: false,
        usernameValidator: (value) => usernameSchema.safeParse(value).success,
        usernameNormalization: (value) => value.trim().toLowerCase(),
      }),
    ],
  });
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];
