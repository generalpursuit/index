import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, type TestContext } from "node:test";
import { createTestDatabase } from "../../testing/database";
import { memoryMediaStore } from "./media";
import { updateProfile, uploadImage } from "./service";

const photo = () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]);
const deferred = () => Promise.withResolvers<void>();

describe("profile photo recovery", () => {
  let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
  let media: ReturnType<typeof memoryMediaStore>;
  let uploaded: string[];
  before(async () => {
    fixture = await createTestDatabase();
  });
  beforeEach(async () => {
    await fixture.reset();
    uploaded = [];
    const storage = memoryMediaStore("https://api.example.test");
    media = {
      ...storage,
      async put(key, bytes, type) {
        uploaded.push(key);
        await storage.put(key, bytes, type);
      },
    };
  });
  after(async () => {
    await fixture?.close();
  });

  async function currentImage() {
    const result = await fixture.client.query<{ image: string | null }>(
      'select image from "user" where id=$1',
      ["alice"],
    );
    return result.rows[0]!.image;
  }
  async function save() {
    const result = await uploadImage(fixture.db, media, "alice", photo());
    assert.ok(result.isOk(), result.isErr() ? result.error.message : "Photo upload failed");
    assert.ok(result.value.image);
    return result.value.image;
  }
  function interceptQueries(
    t: TestContext,
    intercept: (statement: string, run: () => Promise<unknown>) => Promise<unknown>,
  ) {
    const query = fixture.client.query.bind(fixture.client);
    return t.mock.method(fixture.client, "query", (async (...args: Parameters<typeof query>) =>
      intercept(args[0], () => query(...args))) as typeof fixture.client.query);
  }

  it("discards a failed storage upload even when the provider stored it before losing its response", async (t) => {
    const previous = await save();
    const put = media.put;
    t.mock.method(media, "put", async (...args: Parameters<typeof put>) => {
      await put(...args);
      throw new Error("Lost storage response");
    });
    const result = await uploadImage(fixture.db, media, "alice", photo());
    assert.ok(result.isErr());
    assert.equal(await currentImage(), previous);
    assert.ok(media.get(media.keyOf(previous)!));
    assert.equal(media.get(uploaded.at(-1)!), undefined);
  });

  it("retains both objects when a database write fails without a confirmed outcome", async (t) => {
    t.mock.method(console, "warn", () => {});
    const previous = await save();
    await fixture.client
      .exec(`create function reject_photo() returns trigger language plpgsql as $$ begin raise exception 'rejected'; end $$;
      create trigger reject_photo before update of image on "user" for each row execute function reject_photo();`);
    try {
      const result = await uploadImage(fixture.db, media, "alice", photo());
      assert.ok(result.isErr());
      assert.equal(await currentImage(), previous);
      assert.ok(media.get(media.keyOf(previous)!));
      assert.ok(media.get(uploaded.at(-1)!));
    } finally {
      await fixture.client.exec(
        'drop trigger reject_photo on "user"; drop function reject_photo();',
      );
    }
  });

  it("reports committed replacement and removal as successful when old-object cleanup fails", async (t) => {
    await save();
    t.mock.method(console, "warn", () => {});
    t.mock.method(media, "delete", async () => {
      throw new Error("Storage unavailable");
    });
    const next = await save();
    assert.equal(await currentImage(), next);
    assert.ok(media.get(media.keyOf(next)!));
    const removed = await updateProfile(fixture.db, media, "alice", { image: null });
    assert.ok(removed.isOk());
    assert.equal(await currentImage(), null);
  });

  it("keeps an upload when an accepted database write commits after its request reports failure", async (t) => {
    const previous = await save();
    const release = deferred();
    let pending: Promise<unknown> | undefined;
    t.mock.method(console, "warn", () => {});
    const intercepted = interceptQueries(t, async (statement, run) => {
      if (statement.includes('"previous_profile"')) {
        pending = release.promise.then(run);
        throw new Error("Connection lost before accepted statement finished");
      }
      return run();
    });
    try {
      const result = await uploadImage(fixture.db, media, "alice", photo());
      assert.ok(result.isErr(), "Do not claim success after an uncertain write");
      assert.equal(await currentImage(), previous, "A read still sees the previous image");
      assert.ok(media.get(uploaded.at(-1)!));
    } finally {
      release.resolve();
      await pending;
      intercepted.mock.restore();
    }
    assert.equal(await currentImage(), media.url(uploaded.at(-1)!));
    assert.ok(media.get(uploaded.at(-1)!), "The late commit must not point at a deleted object");
  });

  it("keeps an upload after a committed database write loses its response", async (t) => {
    t.mock.method(console, "warn", () => {});
    const intercepted = interceptQueries(t, async (statement, run) => {
      const result = await run();
      if (statement.includes('"previous_profile"')) throw new Error("Lost database response");
      return result;
    });
    const result = await uploadImage(fixture.db, media, "alice", photo());
    assert.ok(result.isErr(), "Do not claim success after an uncertain write");
    intercepted.mock.restore();
    assert.equal(await currentImage(), media.url(uploaded[0]!));
    assert.ok(media.get(uploaded[0]!));
  });

  it("discards an upload when a successful database response confirms the profile no longer exists", async () => {
    const result = await uploadImage(fixture.db, media, "missing-profile", photo());
    assert.ok(result.isErr());
    assert.equal(result.error.code, "NOT_FOUND");
    assert.equal(media.get(uploaded[0]!), undefined);
  });

  for (const nextAction of ["replace", "remove"] as const) {
    it(`cleans the actual replaced image when a concurrent ${nextAction} completes first`, async (t) => {
      const previous = await save();
      const committed = deferred(),
        release = deferred();
      let first = true;
      interceptQueries(t, async (statement, run) => {
        const pause = first && statement.includes('"previous_profile"');
        if (pause) first = false;
        const result = await run();
        if (pause) {
          committed.resolve();
          await release.promise;
        }
        return result;
      });
      const earlier = uploadImage(fixture.db, media, "alice", photo());
      await committed.promise;
      const interveningImage = media.url(uploaded.at(-1)!);
      let expected: string | null;
      try {
        if (nextAction === "replace") expected = await save();
        else {
          const removed = await updateProfile(fixture.db, media, "alice", { image: null });
          assert.ok(removed.isOk());
          expected = null;
        }
      } finally {
        release.resolve();
      }
      assert.ok((await earlier).isOk());
      assert.equal(await currentImage(), expected);
      assert.equal(media.get(media.keyOf(previous)!), undefined);
      assert.equal(media.get(media.keyOf(interveningImage)!), undefined);
      if (expected) assert.ok(media.get(media.keyOf(expected)!));
    });
  }

  it("late removal cleanup cannot delete a concurrently uploaded active image", async (t) => {
    const previous = await save();
    const committed = deferred(),
      release = deferred();
    let first = true;
    interceptQueries(t, async (statement, run) => {
      const pause = first && statement.includes('"previous_profile"');
      if (pause) first = false;
      const result = await run();
      if (pause) {
        committed.resolve();
        await release.promise;
      }
      return result;
    });
    const removal = updateProfile(fixture.db, media, "alice", { image: null });
    await committed.promise;
    let next: string;
    try {
      next = await save();
    } finally {
      release.resolve();
    }
    assert.ok((await removal).isOk());
    assert.equal(await currentImage(), next);
    assert.ok(media.get(media.keyOf(next)!));
    assert.equal(media.get(media.keyOf(previous)!), undefined);
  });
});
