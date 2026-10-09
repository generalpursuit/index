import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import type { relations } from "@index/db/relations";
import * as schema from "@index/db/schema/auth";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { bearer, openAPI, username } from "better-auth/plugins";
import type { PgAsyncDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { usernameSchema } from "./username";

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  CORS_ORIGIN: string;
};

export function createAuth<TQueryResult extends PgQueryResultHKT>(
  env: AuthConfig,
  database: PgAsyncDatabase<TQueryResult, typeof relations>,
  desktopOrigins: readonly string[] = [],
) {
  return betterAuth({
    database: drizzleAdapter(database, {
      provider: "pg",
      schema,
    }),
    trustedOrigins: [env.CORS_ORIGIN, ...desktopOrigins],
    emailAndPassword: { enabled: true },
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
    },
    plugins: [
      bearer({ requireSignature: true }),
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
