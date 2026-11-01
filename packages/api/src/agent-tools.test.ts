import assert from "node:assert/strict";
import { it } from "node:test";
import { ProcedureContract, type AnyProcedureContract } from "@orpc/contract";
import { getOpenAPIMeta } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { getAgentTool } from "./agent-tools";
import { appContract } from "./contracts";

function* procedures(router: object): Generator<AnyProcedureContract> {
  for (const value of Object.values(router)) {
    if (value instanceof ProcedureContract) yield value;
    else if (value && typeof value === "object") yield* procedures(value);
  }
}

it("marks exactly the agent tools, each described for a model", () => {
  const converter = new ZodToJsonSchemaConverter();
  const tools: Record<string, string> = {};
  for (const procedure of procedures(appContract)) {
    const tool = getAgentTool(procedure);
    if (!tool) continue;
    assert.equal(tools[tool.name], undefined, `${tool.name} is marked twice`);
    tools[tool.name] = tool.permission;
    assert.match(tool.name, /^[a-z]+(_[a-z]+)*$/);

    const openapi = getOpenAPIMeta(procedure);
    assert.ok(openapi?.summary, `${tool.name} has a summary`);
    assert.ok(openapi?.description, `${tool.name} has a description`);
    const inputs = procedure["~orpc"].inputSchemas ?? [];
    assert.equal(inputs.length, 1, `${tool.name} has one input`);
    const [schema] = converter.convert(inputs[0], "input");
    assert.equal(
      typeof schema === "object" && schema.type,
      "object",
      `${tool.name} takes an object`,
    );
    for (const [field, property] of Object.entries(
      (schema as { properties?: Record<string, { description?: string }> }).properties ?? {},
    ))
      assert.ok(property.description, `${tool.name}.${field} is described`);
  }
  assert.deepEqual(tools, {
    get_me: "read",
    list_my_links: "read",
    get_person: "read",
    list_person_links: "read",
    list_following_feed: "read",
    get_link: "read",
    list_comments: "read",
    find_people: "read",
    resolve_index_url: "read",
    list_group_links: "read",
    save_link: "write",
    forward_link: "write",
    post_comment: "write",
  });
});
