import type { AppRouterClient } from "@index/api/contracts";
import { linkSchema, listMyLinksOutputSchema } from "@index/api/features/links/schemas";
import { createTestDatabase } from "@index/api/testing/database";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { OpenAPI } from "@orpc/openapi";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { apiHandler, rpcHandler } from "./transport";

describe("HTTP API transports", () => {
  let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
  before(async () => {
    fixture = await createTestDatabase();
  });
  beforeEach(async () => {
    await fixture.reset();
  });
  after(async () => {
    await fixture?.close();
  });

  async function request(path: string, actor: string | null, init?: RequestInit) {
    const result = await apiHandler.handle(
      new Request(`https://api.example.com/api/v1${path}`, init),
      {
        prefix: "/api/v1",
        context: fixture.context(actor),
      },
    );
    assert.ok(result.matched);
    return result.response;
  }

  const save = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const input = { url: "https://example.com/article", title: "An article" };

  it("creates, lists, and reads links through the OpenAPI routes", async () => {
    const created = await request("/links", "alice", save(input));
    assert.equal(created.status, 201);
    const link = linkSchema.parse(await created.json());
    const retrieved = await request(`/links/${link.id}`, "alice");
    assert.equal(retrieved.status, 200);
    assert.deepEqual(await retrieved.json(), link);
    const listed = await request("/links?limit=1", "alice");
    assert.equal(listed.status, 200);
    assert.deepEqual(listMyLinksOutputSchema.parse(await listed.json()), {
      items: [link],
      nextCursor: null,
    });
  });

  it("returns HTTP 400, 401, and 404 for validation, authentication, and access failures", async () => {
    assert.equal(
      (await request("/links", "alice", save({ ...input, url: "javascript:alert(1)" }))).status,
      400,
    );
    assert.equal((await request("/links?limit=101", "alice")).status, 400);
    assert.equal((await request("/links?cursor=garbage", "alice")).status, 400);
    assert.equal((await request("/links", null, save(input))).status, 401);
    const link = linkSchema.parse(await (await request("/links", "alice", save(input))).json());
    assert.equal((await request(`/links/${link.id}`, "bob")).status, 404);
  });

  it("serializes database errors without SQL or driver details", async (t) => {
    const logged = t.mock.method(console, "error", () => {});
    const response = await request("/links", "deleted-user", save(input));
    assert.equal(response.status, 500);
    const body = await response.text();
    assert.match(body, /Something went wrong/);
    assert.doesNotMatch(body, /insert into|foreign key|violates|cause|postgres/i);
    assert.equal(logged.mock.callCount(), 1);
  });

  it("serves the OpenAPI contract with explicit request and response schemas", async () => {
    const response = await request("/openapi.json", null);
    assert.equal(response.status, 200);
    const spec = (await response.json()) as OpenAPI.Document;
    assert.match(spec.openapi, /^3\./);
    assert.ok(spec.paths);
    const body = spec.paths["/links"]?.post?.requestBody;
    assert.ok(body && "content" in body);
    const schema = body.content["application/json"]?.schema;
    assert.ok(schema && !("$ref" in schema));
    const url = schema.properties?.url;
    assert.ok(url && !("$ref" in url));
    assert.equal(url.format, "uri");
    assert.equal(url.maxLength, 8192);
    assert.ok(spec.paths["/links"]?.post?.responses["201"]);
    assert.ok(spec.paths["/links"]?.get);
    assert.ok(spec.paths["/links/{id}"]?.get);
    for (const path of [
      "/groups",
      "/me/profile",
      "/profiles/{userId}/follow",
      "/me/follow-requests",
      "/links/{linkId}/star",
      "/links/{linkId}/comments",
    ]) {
      assert.ok(spec.paths[path], path);
    }
    assert.deepEqual(spec.security, [{ bearerAuth: [] }, { sessionCookie: [] }]);
    assert.deepEqual(spec.paths["/links/{id}"]?.get?.security?.[0], {});
    assert.ok(spec.components?.securitySchemes?.bearerAuth);
    const document = JSON.stringify(spec);
    assert.match(document, /date-time/);
    assert.match(document, /uncategorized/);
    assert.match(document, /nextCursor/);
  });

  it("uses the same contract through the typed RPC client", async () => {
    const rpc: AppRouterClient = createORPCClient(
      new RPCLink({
        url: "https://api.example.com/rpc/v1",
        async fetch(request) {
          const result = await rpcHandler.handle(request, {
            prefix: "/rpc/v1",
            context: fixture.context("alice"),
          });
          assert.ok(result.matched);
          return result.response;
        },
      }),
    );
    const created = await rpc.links.create(input);
    assert.equal(created.ownerId, "alice");
    assert.deepEqual(await rpc.links.get({ id: created.id }), created);
    assert.deepEqual(await rpc.links.listMine({}), { items: [created], nextCursor: null });
    assert.equal(await rpc.healthCheck(), "OK");
  });
});
