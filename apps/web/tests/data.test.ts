import { test } from "node:test";
import assert from "node:assert/strict";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { createContentPersistence } from "../src/data/persistence";
import { cacheMaxAge } from "../src/data/client";
import { instantEdit } from "../src/data/edits";
import { clearAccountState } from "../src/lib/account-boundary";

function memory() {
  const databases = new Map<string, Map<string, string>>();
  return {
    databases,
    storage: (name: string) => {
      let values = databases.get(name);
      if (!values) databases.set(name, (values = new Map()));
      const entries = values;
      return {
        getItem: async (key: string) => entries.get(key) ?? null,
        setItem: async (key: string, value: string) => {
          entries.set(key, value);
        },
        removeItem: async (key: string) => {
          entries.delete(key);
        },
      };
    },
  };
}
const identity = (id: string, revision?: number) => ({
  user: { id, emailVerified: true },
  expiresAt: Date.now() + cacheMaxAge,
  revision,
});
const key = (id: string, feature = "messages", method = "list") =>
  [["viewer", id, feature, method], { type: "query", input: {} }] as const;

for (const mismatch of ["account", "revision", "buster", "age"] as const) {
  test(`disk cache discards a ${mismatch} mismatch before restoring private data`, async () => {
    const memoryStore = memory();
    const source = new QueryClient();
    const disk = createContentPersistence(source, "api", "v1", memoryStore.storage);
    await disk.accept(identity("alice", 3));
    source.setQueryData(key("alice"), { body: "private message" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const store = memoryStore.storage("index.content.api.alice");
    // Saving is throttled; persist an explicit valid envelope for deterministic restore tests.
    const { dehydrate } = await import("@tanstack/react-query");
    await store.setItem(
      "cache",
      JSON.stringify({
        timestamp: mismatch === "age" ? Date.now() - cacheMaxAge - 1 : Date.now(),
        buster: "v1",
        clientState: dehydrate(source),
      }),
    );
    const destination = new QueryClient();
    const next = createContentPersistence(
      destination,
      "api",
      mismatch === "buster" ? "v2" : "v1",
      memoryStore.storage,
    );
    if (mismatch === "account") await next.accept(identity("bob", 3));
    else await next.restore(mismatch === "revision" ? 4 : 3);
    assert.equal(destination.getQueryData(key("alice")), undefined);
    assert.equal(await store.getItem("cache"), null);
    await disk.erase();
    await next.erase();
    source.clear();
    destination.clear();
  });
}

test("only account content persists; secrets, searches and expired content do not", async () => {
  const memoryStore = memory();
  const cache = new QueryClient();
  const disk = createContentPersistence(cache, "api", "v1", memoryStore.storage);
  await disk.accept(identity("alice"));
  cache.setQueryData(["session"], { token: "never persist" });
  cache.setQueryData(key("bob"), "other account");
  cache.setQueryData([["viewer", "alice", "discovery", "searchUsers"], {}], "search");
  cache.setQueryData(key("alice", "links", "get"), "expired", {
    updatedAt: Date.now() - cacheMaxAge - 1,
  });
  cache.setQueryData(key("alice"), "message");
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const restored = new QueryClient();
  const next = createContentPersistence(restored, "api", "v1", memoryStore.storage);
  await next.restore();
  assert.equal(restored.getQueryData(key("alice")), "message");
  assert.equal(restored.getQueryCache().getAll().length, 1);
  await next.erase();
  assert.equal(await memoryStore.storage("index.identity.api").getItem("account"), null);
  await disk.erase();
  cache.clear();
  restored.clear();
});

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
test("instant edits replay concurrent changes on rollback and invalidate only after the last settles", async () => {
  const cache = new QueryClient();
  cache.setQueryData(["item"], { a: 0, b: 0 });
  const first = deferred<number>(),
    second = deferred<number>();
  let invalidations = 0;
  const options = (field: "a" | "b", result: Promise<number>) =>
    instantEdit(cache, {
      key: ["edit"],
      affects: () => true,
      mutationFn: () => result,
      optimistic: (value: number) => (data) => ({ ...(data as object), [field]: value }),
      response: (value) => (data) => ({ ...(data as object), [field]: value }),
      invalidate: () => {
        invalidations++;
      },
    });
  const a = new MutationObserver(cache, options("a", first.promise));
  const b = new MutationObserver(cache, options("b", second.promise));
  const one = a.mutate(1).catch(() => {}),
    two = b.mutate(2);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(cache.getQueryData(["item"]), { a: 1, b: 2 });
  first.reject(new Error("rejected"));
  await one;
  assert.deepEqual(cache.getQueryData(["item"]), { a: 0, b: 2 });
  assert.equal(invalidations, 0);
  second.resolve(3);
  await two;
  assert.deepEqual(cache.getQueryData(["item"]), { a: 0, b: 3 });
  assert.equal(invalidations, 1);
  cache.clear();
});
test("account clearing prevents an instant edit's late rollback from recreating content", async () => {
  const cache = new QueryClient();
  cache.setQueryData(["item"], 0);
  const result = deferred<number>();
  const observer = new MutationObserver(
    cache,
    instantEdit(cache, {
      key: ["edit"],
      affects: () => true,
      mutationFn: () => result.promise,
      optimistic: () => () => 1,
    }),
  );
  const pending = observer.mutate(undefined).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  await clearAccountState(cache);
  result.reject(new Error("old failure"));
  await pending;
  assert.equal(cache.getQueryData(["item"]), undefined);
  cache.clear();
});

test("a confirmed edit survives immediate reload while optimistic drafts stay off disk", async () => {
  const memoryStore = memory();
  const cache = new QueryClient();
  const disk = createContentPersistence(cache, "api", "v1", memoryStore.storage);
  await disk.accept(identity("alice"));
  const queryKey = key("alice");
  cache.setQueryData(queryKey, "server value");
  const answer = deferred<string>();
  const mutation = new MutationObserver(
    cache,
    instantEdit(cache, {
      key: ["edit"],
      affects: () => true,
      mutationFn: () => answer.promise,
      optimistic: () => () => "unconfirmed draft",
      response: (value) => () => value,
    }),
  );
  const pending = mutation.mutate(undefined);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const before = await memoryStore.storage("index.content.api.alice").getItem("cache");
  assert.ok(!before?.includes("unconfirmed draft"));
  answer.resolve("confirmed content");
  await pending;
  const restored = new QueryClient();
  const next = createContentPersistence(restored, "api", "v1", memoryStore.storage);
  await next.restore();
  assert.equal(restored.getQueryData(queryKey), "confirmed content");
  await disk.erase();
  await next.erase();
  cache.clear();
  restored.clear();
});

test("an edit patches a destination that read the previous value while its write was pending", async () => {
  const cache = new QueryClient();
  cache.setQueryData(["list"], "previous");
  const answer = deferred<string>();
  const mutation = new MutationObserver(
    cache,
    instantEdit(cache, {
      key: ["edit"],
      affects: () => true,
      mutationFn: () => answer.promise,
      optimistic: () => () => "pending",
      response: (value) => () => value,
    }),
  );
  const pending = mutation.mutate(undefined);
  await new Promise((resolve) => setTimeout(resolve, 0));
  cache.setQueryData(["destination"], "previous");
  answer.resolve("confirmed");
  await pending;
  assert.equal(cache.getQueryData(["list"]), "confirmed");
  assert.equal(cache.getQueryData(["destination"]), "confirmed");
  cache.clear();
});
