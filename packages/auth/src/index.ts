import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import type { relations } from "@index/db/relations";
import * as schema from "@index/db/schema/auth";
import { betterAuth } from "better-auth";
import { bearer, openAPI } from "better-auth/plugins";
import type { PgAsyncDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

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
    plugins: [bearer({ requireSignature: true }), openAPI({ disableDefaultReference: true })],
  });
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];
