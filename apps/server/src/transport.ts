import { appRouter } from "@index/api/routers/index";
import { SmartCoercionPlugin } from "@orpc/json-schema";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError, ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { BatchHandlerPlugin } from "@orpc/server/plugins";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";

function logUnexpectedError(error: unknown) {
  if (!(error instanceof ORPCError) || error.status >= 500) console.error(error);
}

export const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new SmartCoercionPlugin({ schemaConverters: [new ZodToJsonSchemaConverter()] }),
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
      specPath: "/openapi.json",
      docsPath: "/docs",
      specGenerateOptions: {
        info: { title: "Index API", version: "1.0.0" },
        servers: [{ url: "/api/v1" }],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: "http",
              scheme: "bearer",
              description: "Signed set-auth-token returned by Better Auth sign-in.",
            },
            sessionCookie: {
              type: "apiKey",
              in: "cookie",
              name: "__Secure-better-auth.session_token",
            },
          },
        },
        security: [{ bearerAuth: [] }, { sessionCookie: [] }],
      },
    }),
  ],
  interceptors: [onError(logUnexpectedError)],
});

export const rpcHandler = new RPCHandler(appRouter, {
  plugins: [new BatchHandlerPlugin()],
  interceptors: [onError(logUnexpectedError)],
});
