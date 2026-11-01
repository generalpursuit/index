import { defineMeta } from "@orpc/contract";

/** What an agent's grant must include to call a tool. Writing implies reading. */
export type AgentPermission = "read" | "write";

export interface AgentTool {
  /** The tool's snake_case name, which agents call it by. */
  name: string;
  permission: AgentPermission;
}

/**
 * Marks a contract procedure as a tool agents may call. Agents learn the tool from the
 * procedure's OpenAPI summary and description and its input fields' descriptions, so a marked
 * procedure takes an object input whose every field is described.
 */
export const [agentTool, getAgentTool] = defineMeta(
  "index/agentTool",
  (incoming: AgentTool) => incoming,
);
