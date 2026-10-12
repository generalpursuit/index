import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setupApiTests } from "../testing/api";

describe("visibility across profiles, groups and links", () => {
  const api = setupApiTests();
  for (const profileVisibility of ["public", "private"] as const) {
    for (const visibility of ["public", "private"] as const) {
      it(`${profileVisibility} profile, ${visibility} group: enforces access for each viewer`, async () => {
        const owner = api.client("alice");
        await owner.profiles.update({ profileVisibility });
        const group = await owner.groups.create({ name: "Reading", visibility });
        const link = await owner.links.create({
          url: "https://example.com",
          title: "Read",
          groupId: group.id,
        });
        const ungrouped = await owner.links.create({
          url: "https://example.com/ungrouped",
          title: "Ungrouped",
        });
        await api.client("bob").follows.follow({ userId: "alice" });
        await owner.follows.accept({ userId: "bob" });
        if (profileVisibility === "private")
          await api.client("carol").follows.follow({ userId: "alice" });
        for (const viewer of ["alice", "bob", "carol", "dana", null]) {
          const client = api.client(viewer);
          const allowed =
            viewer === "alice" ||
            (visibility === "public" && (profileVisibility === "public" || viewer === "bob"));
          const profile = await client.profiles.get({ userId: "alice" });
          const canViewProfile =
            viewer === "alice" || profileVisibility === "public" || viewer === "bob";
          assert.equal(profile.canViewContent, canViewProfile);
          assert.equal(
            profile.linkCount,
            viewer === "alice"
              ? 2
              : profileVisibility === "private"
                ? null
                : visibility === "public"
                  ? 2
                  : 1,
            "Profile counts include visible ungrouped links and exclude locked links",
          );
          assert.equal("email" in profile, false);
          if (allowed) {
            assert.equal((await client.groups.get({ id: group.id })).id, group.id);
            assert.equal((await client.links.get({ id: link.id })).id, link.id);
            assert.deepEqual(
              (await client.links.listInGroup({ groupId: group.id })).items.map((item) => item.id),
              [link.id],
            );
          } else {
            await assert.rejects(client.groups.get({ id: group.id }), { code: "NOT_FOUND" });
            await assert.rejects(client.links.get({ id: link.id }), { code: "NOT_FOUND" });
            await assert.rejects(client.links.listInGroup({ groupId: group.id }), {
              code: "NOT_FOUND",
            });
          }
          assert.equal(
            (await client.groups.list({ ownerId: "alice" })).items.some(
              (item) => item.id === group.id,
            ),
            allowed,
          );
          // Links outside any group follow the profile; only locked groups hide links further.
          if (canViewProfile)
            assert.equal((await client.links.get({ id: ungrouped.id })).id, ungrouped.id);
          else await assert.rejects(client.links.get({ id: ungrouped.id }), { code: "NOT_FOUND" });
        }
      });
    }
  }
});
