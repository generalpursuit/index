import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setupApiTests } from "../../testing/api";
import { updateProfileSchema } from "./schemas";

describe("profiles", () => {
  const api = setupApiTests();
  it("normalizes unique usernames and exposes only public identity fields", async () => {
    const alice = api.client("alice");
    const updated = await alice.profiles.update({
      username: " Alice_123 ",
      name: "Alice Example",
      image: "https://example.com/avatar.png",
    });
    assert.equal(updated.username, "alice_123");
    assert.equal((await alice.profiles.me()).name, "Alice Example");
    const profile = await api.client(null).profiles.byUsername({ username: "ALICE_123" });
    assert.equal(profile.id, "alice");
    assert.equal("email" in profile, false);
    assert.equal("emailVerified" in profile, false);
    assert.equal("bio" in profile, false);
    assert.equal(updateProfileSchema.safeParse({ bio: "Removed field" }).success, false);
    const columns = await api.postgres.query(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'user' and column_name = 'bio'",
    );
    assert.equal(columns.rows.length, 0);
    await assert.rejects(api.client("bob").profiles.update({ username: "Alice_123" }), {
      code: "CONFLICT",
    });
    await assert.rejects(alice.profiles.update({ username: "ab" }), { code: "BAD_REQUEST" });
    await assert.rejects(alice.profiles.update({}), { code: "BAD_REQUEST" });
    await assert.rejects(api.client(null).profiles.me(), { code: "UNAUTHORIZED" });
  });
});
