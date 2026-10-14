import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { currentWeekStart } from "../shared/weeks";
import { setupApiTests } from "./api";

describe("independent screen reads", () => {
  const api = setupApiTests();

  it("starts independent statements before the first database response", async (t) => {
    const alice = api.client("alice");
    const group = await alice.groups.create({ name: "Reading" });
    await alice.links.create({ url: "https://example.com", groupId: group.id });
    await alice.follows.follow({ userId: "bob" });
    const conversation = await alice.messages.createConversation({ recipientIds: ["bob"] });
    await alice.messages.send({
      conversationId: conversation.id,
      clientId: crypto.randomUUID(),
      body: "Hello",
    });
    const reads = [
      { name: "own profile", run: () => alice.profiles.me(), initial: 2, total: 2 },
      {
        name: "profile by ID",
        run: () => alice.profiles.get({ userId: "bob" }),
        initial: 2,
        total: 2,
      },
      { name: "activity", run: () => alice.activity.list({}), initial: 2, total: 2 },
      {
        name: "week",
        run: () => alice.feed.week({ weekStart: currentWeekStart() }),
        initial: 2,
        total: 3,
      },
      {
        name: "conversation",
        run: () => alice.messages.conversation({ conversationId: conversation.id }),
        initial: 3,
        total: 3,
      },
      {
        name: "messages",
        run: () => alice.messages.list({ conversationId: conversation.id }),
        initial: 2,
        total: 2,
      },
      {
        name: "group links",
        run: () => alice.links.listInGroup({ groupId: group.id }),
        initial: 2,
        total: 2,
      },
      { name: "pulse", run: () => alice.pulse.get(), initial: 2, total: 2 },
    ];
    const query = api.postgres.query.bind(api.postgres);
    let started = 0,
      finished = 0,
      initiallyPending = 0;
    t.mock.method(api.postgres, "query", ((...args: Parameters<typeof query>) => {
      started++;
      return query(...args).finally(() => {
        if (finished++ === 0) initiallyPending = started;
      });
    }) as typeof query);

    for (const read of reads) {
      started = finished = initiallyPending = 0;
      await read.run();
      assert.equal(initiallyPending, read.initial, read.name);
      assert.equal(started, read.total, read.name);
    }
  });
});
