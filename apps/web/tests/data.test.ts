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

test("hiding a cached item keeps its observer attached for rollback", async () => {
  const { QueryObserver } = await import("@tanstack/react-query");
  const cache = new QueryClient();
  cache.setQueryData(["private"], "previously authorized");
  const observer = new QueryObserver(cache, { queryKey: ["private"], enabled: false });
  const unsubscribe = observer.subscribe(() => {});
  const answer = deferred<string>();
  const mutation = new MutationObserver(
    cache,
    instantEdit(cache, {
      key: ["edit"],
      affects: () => true,
      mutationFn: () => answer.promise,
      optimistic: () => () => undefined,
    }),
  );
  const pending = mutation.mutate(undefined).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(observer.getCurrentResult().data, null);
  answer.reject(new Error("write failed"));
  await pending;
  assert.equal(observer.getCurrentResult().data, "previously authorized");
  unsubscribe();
  cache.clear();
});

for (const operation of ["getItem", "setItem", "removeItem"] as const) {
  test(`storage ${operation} failures never block accepting or clearing an account`, async () => {
    const store = memory();
    let fail = false;
    const storage = (name: string) => {
      const underlying = store.storage(name);
      return {
        getItem: async (key: string) => {
          if (fail && operation === "getItem") throw new Error("disabled storage");
          return underlying.getItem(key);
        },
        setItem: async (key: string, value: string) => {
          if (fail && operation === "setItem") throw new Error("quota exceeded");
          await underlying.setItem(key, value);
        },
        removeItem: async (key: string) => {
          if (fail && operation === "removeItem") throw new Error("connection lost");
          await underlying.removeItem(key);
        },
      };
    };
    const cache = new QueryClient();
    const disk = createContentPersistence(cache, "api", "v1", storage);
    await disk.accept(identity("alice"));
    cache.setQueryData(key("alice"), "alice content");
    fail = true;
    await disk.accept(identity("alice"));
    await disk.erase();
    await disk.accept(identity("bob"));
    assert.notEqual((await disk.restore())?.user.id, "alice");
    fail = false;
    cache.clear();
    await disk.accept(identity("bob"));
    cache.setQueryData(key("bob"), "bob content");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const nextCache = new QueryClient();
    const next = createContentPersistence(nextCache, "api", "v1", storage);
    await next.restore();
    assert.equal(nextCache.getQueryData(key("bob")), "bob content");
    assert.equal(nextCache.getQueryData(key("alice")), undefined);
    await disk.erase();
    await next.erase();
    cache.clear();
    nextCache.clear();
  });
}

test("a peer's changed account marker stops queued content writes", async () => {
  const store = memory();
  const cache = new QueryClient();
  const disk = createContentPersistence(cache, "api", "v1", store.storage);
  await disk.accept(identity("alice"));
  cache.setQueryData(key("alice"), "response from a replaced cookie");
  await store
    .storage("index.identity.api")
    .setItem("account", JSON.stringify({ ...identity("bob"), buster: "v1" }));
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(await store.storage("index.content.api.alice").getItem("cache"), null);
  await disk.accept(identity("alice"));
  assert.equal(
    JSON.parse((await store.storage("index.identity.api").getItem("account"))!).user.id,
    "bob",
  );
  await disk.erase();
  await disk.erase();
  assert.equal(
    JSON.parse((await store.storage("index.identity.api").getItem("account"))!).user.id,
    "bob",
  );
  cache.clear();
});

test("instant edits leave missing loads running and retain permission errors", async () => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const loading = deferred<string>();
  const read = cache.fetchQuery({
    queryKey: ["loading"],
    queryFn: ({ signal }) => {
      signal.addEventListener("abort", () => assert.fail("missing load was cancelled"));
      return loading.promise;
    },
  });
  const forbidden = new Error("Forbidden");
  await cache
    .fetchQuery({
      queryKey: ["forbidden"],
      queryFn: () => {
        throw forbidden;
      },
    })
    .catch(() => {});
  const mutation = new MutationObserver(
    cache,
    instantEdit(cache, {
      key: ["edit"],
      affects: () => true,
      mutationFn: async () => "done",
      optimistic: () => (data) => data,
    }),
  );
  await mutation.mutate(undefined);
  assert.equal(cache.getQueryState(["loading"])?.fetchStatus, "fetching");
  assert.equal(cache.getQueryState(["forbidden"])?.status, "error");
  assert.equal(cache.getQueryState(["forbidden"])?.error, forbidden);
  loading.resolve("loaded");
  assert.equal(await read, "loaded");
  cache.clear();
});

for (const outcome of ["success", "failure"] as const) {
  test(`instant edit ${outcome} retains arrivals and newer fields from a server refresh`, async () => {
    const cache = new QueryClient();
    const before = { items: [{ id: "old", body: "old", favorite: false }] };
    cache.setQueryData(["list"], before, { updatedAt: 123 });
    cache.setQueryData(["untouched"], "unchanged", { updatedAt: 456 });
    const answer = deferred<boolean>();
    const patch = (favorite: boolean) => (data: unknown) => {
      if (typeof data === "string") return data;
      const list = data as typeof before;
      return {
        items: list.items.map((item) => (item.id === "old" ? { ...item, favorite } : item)),
      };
    };
    const mutation = new MutationObserver(
      cache,
      instantEdit(cache, {
        key: ["edit"],
        affects: () => true,
        mutationFn: () => answer.promise,
        optimistic: () => patch(true),
        response: (value) => patch(value),
      }),
    );
    const pending = mutation.mutate(undefined).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(cache.getQueryState(["list"])?.dataUpdatedAt, 123);
    const incoming = { id: "new", body: "arrived meanwhile", favorite: false };
    cache.setQueryData(
      ["list"],
      { items: [incoming, { id: "old", body: "newer server text", favorite: true }] },
      { updatedAt: 789 },
    );
    if (outcome === "success") answer.resolve(true);
    else answer.reject(new Error("rejected"));
    await pending;
    assert.deepEqual(cache.getQueryData(["list"]), {
      items: [incoming, { id: "old", body: "newer server text", favorite: outcome === "success" }],
    });
    assert.equal(cache.getQueryState(["list"])?.dataUpdatedAt, 789);
    assert.equal(cache.getQueryState(["untouched"])?.dataUpdatedAt, 456);
    cache.clear();
  });
}

test("a failed edit cannot restore content erased by a permission refresh", async () => {
  const cache = new QueryClient();
  cache.setQueryData(["item"], "authorized");
  const answer = deferred<string>();
  const mutation = new MutationObserver(
    cache,
    instantEdit(cache, {
      key: ["edit"],
      affects: () => true,
      mutationFn: () => answer.promise,
      optimistic: () => () => "optimistic",
    }),
  );
  const pending = mutation.mutate(undefined).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  const query = cache.getQueryCache().find({ queryKey: ["item"] })!;
  const error = new Error("Forbidden");
  query.setState({ data: undefined, dataUpdatedAt: 0, error, status: "error" });
  answer.reject(new Error("failed write"));
  await pending;
  assert.equal(query.state.data, undefined);
  assert.equal(query.state.error, error);
  cache.clear();
});

test("unchanged response trees never publish an edit write or extend freshness", async () => {
  const cache = new QueryClient();
  const data = { items: [{ id: "unrelated", name: "Unchanged" }] };
  cache.setQueryData(["unchanged"], data, { updatedAt: 123 });
  let writes = 0;
  const unsubscribe = cache.getQueryCache().subscribe((event) => {
    if (event.type === "updated" && event.action.type === "success") writes++;
  });
  const mutation = new MutationObserver(
    cache,
    instantEdit(cache, {
      key: ["edit"],
      affects: () => true,
      mutationFn: async () => "done",
      optimistic: () => (current) => structuredClone(current),
      response: () => (current) => structuredClone(current),
    }),
  );
  await mutation.mutate(undefined);
  assert.equal(writes, 0);
  assert.equal(cache.getQueryData(["unchanged"]), data);
  assert.equal(cache.getQueryState(["unchanged"])?.dataUpdatedAt, 123);
  unsubscribe();
  cache.clear();
});
