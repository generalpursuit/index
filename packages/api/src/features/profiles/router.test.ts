import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setupApiTests } from "../../testing/api";
import { media } from "../../testing/database";
import { maxPhotoBytes } from "./media";
import { updateProfileSchema } from "./schemas";

describe("profiles", () => {
  const api = setupApiTests();
  it("normalizes unique usernames and exposes only public identity fields", async () => {
    const alice = api.client("alice");
    const updated = await alice.profiles.update({
      username: " Alice_123 ",
      name: "Alice Example",
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

  it("uploads, replaces and removes a photo, and refuses addresses and other files", async () => {
    const alice = api.client("alice");
    // Real signatures: the server reads what a file is from its first bytes.
    const signatures: Record<string, number[]> = {
      png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      webp: [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
      text: [0x68, 0x69],
    };
    // The declared type is ignored on purpose; some runtimes drop it.
    const photo = (kind: string, size = 64) => {
      const bytes = new Uint8Array(size);
      bytes.set(signatures[kind]!);
      return new File([bytes], "photo", { type: "" });
    };
    const stored = (url: string | null) => (url ? media.get(media.keyOf(url) ?? "") : undefined);
    const first = await alice.profiles.uploadImage({ image: photo("png") });
    assert.match(
      first.image ?? "",
      /^https:\/\/api\.example\.test\/media\/avatars\/alice\/.+\.png$/,
    );
    assert.equal(stored(first.image)?.contentType, "image/png");
    // A new photo gets a new address, and the old one is deleted.
    const second = await alice.profiles.uploadImage({ image: photo("webp") });
    assert.equal(stored(second.image)?.contentType, "image/webp");
    assert.notEqual(second.image, first.image);
    assert.equal(stored(first.image), undefined);
    assert.ok(stored(second.image));
    const removed = await alice.profiles.update({ image: null });
    assert.equal(removed.image, null);
    assert.equal(stored(second.image), undefined);
    // Photos are only uploaded: no addresses, other files or oversized images.
    await assert.rejects(
      alice.profiles.update({ image: "https://example.com/avatar.png" as unknown as null }),
      { code: "BAD_REQUEST" },
    );
    await assert.rejects(alice.profiles.uploadImage({ image: photo("text") }), {
      code: "BAD_REQUEST",
    });
    await assert.rejects(alice.profiles.uploadImage({ image: photo("png", maxPhotoBytes + 1) }), {
      code: "BAD_REQUEST",
    });
    await assert.rejects(api.client(null).profiles.uploadImage({ image: photo("png") }), {
      code: "UNAUTHORIZED",
    });
  });
});
