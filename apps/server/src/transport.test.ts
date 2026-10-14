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
    const locked = (await (
      await request("/groups", "alice", save({ name: "Locked", visibility: "private" }))
    ).json()) as { id: string };
    const link = linkSchema.parse(
      await (await request("/links", "alice", save({ ...input, groupId: locked.id }))).json(),
    );
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
      "/feed",
      "/feed/week",
      "/profiles/{userId}/weeks",
      "/profiles/{userId}/links",
      "/links/{linkId}/favorite",
      "/me/favorites",
      "/me/activity",
      "/conversations",
      "/conversations/{conversationId}/messages",
      "/conversations/{conversationId}/read",
      "/me/messages/unread",
      "/me/pulse",
      "/discovery/users",
      "/discovery/recommendations",
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

  it("serves social writes and anonymous reads through the HTTP contract", async () => {
    const groupResponse = await request("/groups", "alice", save({ name: "Reading" }));
    assert.equal(groupResponse.status, 201);
    const group = (await groupResponse.json()) as { id: string };
    const created = await request("/links", "alice", save({ ...input, groupId: group.id }));
    const link = linkSchema.parse(await created.json());
    assert.equal((await request(`/links/${link.id}`, null)).status, 200);
    const follow = await request("/profiles/alice/follow", "bob", save({}));
    assert.deepEqual(await follow.json(), { status: "accepted" });
    const starred = await request(`/links/${link.id}/star`, "bob", { ...save({}), method: "PUT" });
    assert.equal(starred.status, 200);
    const comment = await request(
      `/links/${link.id}/comments`,
      "bob",
      save({ body: "Worth reading" }),
    );
    assert.equal(comment.status, 201);
    assert.equal((await request(`/links/${link.id}/comments?limit=1`, null)).status, 200);
    const updated = await request(`/links/${link.id}`, "alice", {
      ...save({ title: "Changed" }),
      method: "PATCH",
    });
    assert.equal(linkSchema.parse(await updated.json()).title, "Changed");
    const hidden = await request(`/groups/${group.id}`, "alice", {
      ...save({ visibility: "private" }),
      method: "PATCH",
    });
    assert.equal(hidden.status, 200);
    assert.equal((await request(`/links/${link.id}`, "bob")).status, 404);
    const deleted = await request(`/groups/${group.id}`, "alice", {
      ...save({ deleteLinks: true }),
      method: "DELETE",
    });
    assert.equal(deleted.status, 200, await deleted.clone().text());
    assert.equal((await request(`/links/${link.id}`, "alice")).status, 404);
  });

  it("serves messages, favorites, activity and week reads through REST", async () => {
    await request("/profiles/bob/follow", "alice", save({}));
    const created = await request("/conversations", "alice", save({ recipientIds: ["bob"] }));
    assert.equal(created.status, 200);
    const c = (await created.json()) as { id: string };
    const sent = await request(
      `/conversations/${c.id}/messages`,
      "alice",
      save({ clientId: crypto.randomUUID(), body: "Hello" }),
    );
    assert.equal(sent.status, 200);
    assert.equal((await request(`/conversations/${c.id}/messages`, null)).status, 401);
    assert.equal((await request("/me/activity?limit=1", "bob")).status, 200);
    const pulse = await request("/me/pulse", "bob");
    assert.equal(pulse.status, 200);
    const state = (await pulse.json()) as {
      messages: { unreadCount: number; version: string };
      activity: { unreadCount: number; version: string };
    };
    assert.equal(state.messages.unreadCount, 1);
    assert.equal(typeof state.activity.version, "string");
    assert.equal((await request("/me/pulse", null)).status, 401);
    assert.equal((await request("/feed/week?weekStart=2026-01-05", "alice")).status, 200);
    assert.equal((await request("/feed/week?weekStart=2026-01-06", "alice")).status, 400);
    assert.equal((await request("/profiles/alice/weeks", null)).status, 200);
    const link = linkSchema.parse(await (await request("/links", "alice", save(input))).json());
    assert.equal(
      (await request(`/links/${link.id}/favorite`, "alice", { ...save({}), method: "PUT" })).status,
      200,
    );
    const groups = (await (await request("/groups", "alice")).json()) as {
      items: { kind: string }[];
    };
    assert(groups.items.some((g) => g.kind === "favorites"));
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
    assert.equal((await rpc.pulse.get()).messages.unreadCount, 0);
  });
});
