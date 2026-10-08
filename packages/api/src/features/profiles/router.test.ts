import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setupApiTests } from "../../testing/api";

describe("profiles", () => {
  const api = setupApiTests();
  it("normalizes unique usernames and exposes only public identity fields", async () => {
    const alice = api.client("alice");
    const updated = await alice.profiles.update({
      username: " Alice_123 ",
      name: "Alice Example",
      bio: "Notes",
      image: "https://example.com/avatar.png",
    });
    assert.equal(updated.username, "alice_123");
    assert.equal((await alice.profiles.me()).bio, "Notes");
    const profile = await api.client(null).profiles.byUsername({ username: "ALICE_123" });
    assert.equal(profile.id, "alice");
    assert.equal("email" in profile, false);
    assert.equal("emailVerified" in profile, false);
    await assert.rejects(api.client("bob").profiles.update({ username: "Alice_123" }), {
      code: "CONFLICT",
    });
    await assert.rejects(alice.profiles.update({ username: "ab" }), { code: "BAD_REQUEST" });
    await assert.rejects(alice.profiles.update({}), { code: "BAD_REQUEST" });
    await assert.rejects(api.client(null).profiles.me(), { code: "UNAUTHORIZED" });
  });
});
