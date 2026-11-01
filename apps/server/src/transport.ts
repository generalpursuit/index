import { appRouter } from "@index/api/routers/index";
import { SmartCoercionHandlerPlugin } from "@orpc/json-schema";
import { COMMON_ERROR_STATUS_MAP, OpenAPIGenerator, type OpenAPIDocument } from "@orpc/openapi";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferenceHandlerPlugin } from "@orpc/openapi/plugins";
import { DEFAULT_ERROR_STATUS, onError, ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { BatchHandlerPlugin } from "@orpc/server/plugins";
import { ZodToJsonSchemaConverter } from "@orpc/zod";

// Both transports, the documented responses and logging share one status per error code.
const errorStatusMap: Record<string, number> = COMMON_ERROR_STATUS_MAP;
const errorStatus = (error: ORPCError<string, unknown>) =>
  errorStatusMap[error.code] ?? DEFAULT_ERROR_STATUS;

function logUnexpectedError(error: unknown) {
  if (!(error instanceof ORPCError) || errorStatus(error) >= 500) console.error(error);
}

const converters = [new ZodToJsonSchemaConverter()];
let specification: Promise<OpenAPIDocument<"3.1.1">> | undefined;
// Generated on first request, so Worker startup does not pay for it.
const generateSpecification = () =>
  (specification ??= new OpenAPIGenerator({ converters }).generate(appRouter, {
    version: "3.1.1",
    errorStatusMap,
    base: {
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
  }));

export const apiHandler = new OpenAPIHandler(appRouter, {
  errorStatusMap,
  plugins: [
    new SmartCoercionHandlerPlugin({ converters }),
    new OpenAPIReferenceHandlerPlugin({
      spec: generateSpecification,
      specPath: "/openapi.json",
      docsPath: "/docs",
    }),
  ],
  interceptors: [onError(logUnexpectedError)],
});

export const rpcHandler = new RPCHandler(appRouter, {
  errorStatusMap,
  plugins: [new BatchHandlerPlugin()],
  interceptors: [onError(logUnexpectedError)],
});
