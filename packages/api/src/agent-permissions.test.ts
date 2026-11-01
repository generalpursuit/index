import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setupApiTests } from "./testing/api";

describe("agent permissions", () => {
  const api = setupApiTests();
  const save = (url = "https://example.com") => ({ url, requestId: crypto.randomUUID() });

  it("lets a read grant call read tools and refuses write tools", async () => {
    const agent = api.agent("alice", ["read"]);
    const link = await api.client("alice").links.create({ url: "https://example.com" });
    assert.deepEqual(
      (await agent.links.listMine({})).items.map((item) => item.id),
      [link.id],
    );
    await assert.rejects(agent.links.share(save("https://example.org")), {
      code: "FORBIDDEN",
      message: "This connection can only read. Connect the app again with write access.",
    });
  });

  it("lets a write grant act as its user through write tools", async () => {
    const saved = await api.agent("alice", ["read", "write"]).links.share(save());
    assert.equal(saved.status, "saved");
    assert.equal(saved.link.ownerId, "alice");
  });

  it("refuses every procedure not marked as a tool, whatever the grant", async () => {
    const agent = api.agent("alice", ["read", "write"]);
    const { link } = await agent.links.share(save());
    for (const call of [
      () => agent.links.delete({ id: link.id }),
      () => agent.healthCheck({}),
      () => agent.notifications.preferences({}),
      () => agent.live.ticket({}),
    ])
      await assert.rejects(call(), { code: "FORBIDDEN", message: "Connected apps can't do this." });
    // The user's own session is unaffected.
    await api.client("alice").links.delete({ id: link.id });
  });
});
