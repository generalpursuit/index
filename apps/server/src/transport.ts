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
    // Documents the body `errorResponseBodyEncoder` sends.
    errorResponseBodySchema: (definedErrors, status) => ({
      oneOf: [
        ...definedErrors.map(({ code, defaultMessage, dataJsonSchema, dataOptional }) => ({
          type: "object" as const,
          properties: {
            defined: { const: true },
            code: { const: code },
            status: { const: status },
            message: { type: "string" as const, default: defaultMessage },
            data: dataJsonSchema,
          },
          required: ["defined", "code", "status", "message", ...(dataOptional ? [] : ["data"])],
        })),
        {
          type: "object" as const,
          properties: {
            defined: { const: false },
            code: { type: "string" as const },
            status: { type: "number" as const },
            message: { type: "string" as const },
            data: {},
          },
          required: ["defined", "code", "status", "message"],
        },
      ],
    }),
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
  // REST clients rely on the published error body, which includes `status`.
  errorResponseBodyEncoder: (error) => ({
    defined: error.defined,
    code: error.code,
    status: errorStatus(error),
    // An undefined internal error is an unexpected exception, not one a procedure threw. oRPC 2
    // names it "Internal Server Error"; the published v1 body says "Internal server error".
    message:
      error.code === "INTERNAL_SERVER_ERROR" && !error.defined
        ? "Internal server error"
        : error.message,
    data: error.data,
  }),
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
