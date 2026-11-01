import { getAgentTool, type AgentPermission } from "@index/api/agent-tools";
import type { Context as ApiContext } from "@index/api/context";
import { appRouter } from "@index/api/routers/index";
import { mcpResource } from "@index/auth/connections";
import {
  bearerAuthChallengeResponse,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  McpServer,
  OAuthError,
  OAuthErrorCode,
} from "@modelcontextprotocol/server";
import { mcp, McpRegistrar } from "@orpc/mcp";
import { DecoratedProcedure, onError, Procedure, type AnyProcedure } from "@orpc/server";
import { logUnexpectedError } from "./transport";

type BackgroundTask = (task: Promise<unknown>) => void;

export type McpOptions = {
  /** The stage's API origin. The MCP resource and its metadata live under it. */
  apiURL: string;
  /** The context of an MCP request, or null unless its Bearer token authorizes an agent. */
  createContext: (request: Request, backgroundTask: BackgroundTask) => Promise<ApiContext | null>;
};

/** MCP clients authorize with a Bearer token from any origin; cookies never count there. */
export const mcpCorsPolicy = {
  origin: "*",
  allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowHeaders: [
    "Authorization",
    "Content-Type",
    "MCP-Protocol-Version",
    "Mcp-Method",
    "Mcp-Name",
    "Mcp-Session-Id",
    "Last-Event-ID",
  ],
  exposeHeaders: ["WWW-Authenticate"],
};

/**
 * The agent tools a grant may call, under their tool names. A tool runs as its procedure with
 * all of its middleware, so `authorizeAgent` checks every call again.
 */
function toolsFor(permissions: AgentPermission[]) {
  const tools: Record<string, AnyProcedure> = {};
  const collect = (router: object) => {
    for (const value of Object.values(router)) {
      if (!(value instanceof Procedure)) {
        if (value && typeof value === "object") collect(value);
        continue;
      }
      const tool = getAgentTool(value);
      if (tool && permissions.includes(tool.permission))
        tools[tool.name] = new DecoratedProcedure(value["~orpc"]).meta(
          mcp.tool({ name: tool.name, annotations: { readOnlyHint: tool.permission === "read" } }),
        );
    }
  };
  collect(appRouter);
  return tools;
}

const registrar = (permissions: AgentPermission[]) =>
  new McpRegistrar(toolsFor(permissions), { interceptors: [onError(logUnexpectedError)] });

// A read-only connection doesn't see write tools. Each request registers the tools of its
// grant on a fresh server.
const registrars = { read: registrar(["read"]), write: registrar(["read", "write"]) };

/**
 * Serves the MCP endpoint over stateless Streamable HTTP: the 2026-07-28 protocol, and the
 * 2025-era versions through the SDK's stateless fallback, which most clients still speak.
 * Every request authorizes with its own access token.
 */
export function mcpHandler({ apiURL, createContext }: McpOptions) {
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(new URL(mcpResource(apiURL)));
  return async (request: Request, backgroundTask: BackgroundTask) => {
    const context = await createContext(request, backgroundTask);
    if (context?.caller?.kind !== "agent")
      return bearerAuthChallengeResponse(
        new OAuthError(OAuthErrorCode.InvalidToken, "Connect this app to Index again."),
        { resourceMetadataUrl },
      );
    const tools = context.caller.permissions.includes("write") ? registrars.write : registrars.read;
    const handler = createMcpHandler(async () => {
      const server = new McpServer({ name: "Index", version: "1.0.0" });
      await tools.register(server, { context });
      return server;
    });
    return handler.fetch(request);
  };
}
