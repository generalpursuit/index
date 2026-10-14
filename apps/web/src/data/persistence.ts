import type { Query, QueryClient } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
} from "@tanstack/query-persist-client-core";
import { cacheMaxAge } from "./client";
import type { ContentStorage } from "./storage";

type Identity = {
  user: { id: string; emailVerified: boolean };
  expiresAt: number;
  revision?: number;
};
const content = new Set([
  "feed",
  "profiles",
  "groups",
  "links",
  "comments",
  "follows",
  "messages",
  "activity",
  "routes",
  "favorites",
  "stars",
  "discovery",
]);
export function persistContent(query: Query, account: string) {
  const [path, options] = query.queryKey as [
    string[],
    { input?: { query?: string }; type?: string },
  ];
  return (
    Array.isArray(path) &&
    path[0] === "viewer" &&
    path[1] === account &&
    content.has(path[2]!) &&
    path[3] !== "searchUsers" &&
    !options?.input?.query &&
    query.state.status === "success" &&
    query.state.dataUpdatedAt > Date.now() - cacheMaxAge
  );
}

/** Binding changes stop queued writes synchronously; erasure completes before acceptance. */
export function createContentPersistence<T extends Identity>(
  cache: QueryClient,
  origin: string,
  buster: string,
  storageFor: (name: string) => ContentStorage,
) {
  const metadata = storageFor(`index.identity.${origin}`);
  let accepted: T | undefined;
  let unsubscribe: (() => void) | undefined;
  let epoch = 0;
  let erasing: Promise<unknown> = Promise.resolve();
  const storage = (id: string) => storageFor(`index.content.${origin}.${id}`);
  async function erase() {
    ++epoch;
    unsubscribe?.();
    unsubscribe = undefined;
    const prior = accepted;
    accepted = undefined;
    // Queue deletion after any already-started transaction, before a new account can bind.
    erasing = erasing.then(async () => {
      const marker = await metadata.getItem("account");
      await metadata.removeItem("account");
      const id = prior?.user.id ?? (marker ? (JSON.parse(marker) as T).user.id : undefined);
      if (id) await storage(id).removeItem("cache");
    });
    return erasing;
  }
  async function accept(identity: T) {
    if (!identity.user.emailVerified) {
      await erase();
      return;
    }
    if (accepted?.user.id === identity.user.id && accepted.revision === identity.revision) {
      accepted = identity;
      await metadata.setItem("account", JSON.stringify({ ...identity, buster }));
      return;
    }
    const before = epoch;
    if (accepted) await erase();
    else {
      const marker = await metadata.getItem("account");
      if (epoch !== before) return;
      if (marker && (JSON.parse(marker) as T).user.id !== identity.user.id) await erase();
    }
    const waiting = epoch;
    await erasing;
    if (waiting !== epoch) return;
    const expected = ++epoch;
    accepted = identity;
    const underlying = storage(identity.user.id);
    const guarded: ContentStorage = {
      getItem: async (key) => (expected === epoch ? underlying.getItem(key) : null),
      setItem: async (key, value) => {
        if (expected === epoch) await underlying.setItem(key, value);
      },
      removeItem: (key) => underlying.removeItem(key),
    };
    const persister = createAsyncStoragePersister({
      storage: guarded,
      key: "cache",
      throttleTime: 1000,
    });
    const options = {
      queryClient: cache,
      persister,
      maxAge: cacheMaxAge,
      buster,
      dehydrateOptions: {
        shouldDehydrateQuery: (query: Query) => persistContent(query, identity.user.id),
        shouldDehydrateMutation: () => false,
      },
    };
    // Hydrate into a detached client so a sign-out during disk I/O cannot publish old content.
    const { QueryClient, dehydrate, hydrate } = await import("@tanstack/react-query");
    const restored = new QueryClient();
    await persistQueryClientRestore({ ...options, queryClient: restored });
    if (epoch !== expected) return;
    hydrate(cache, dehydrate(restored, options.dehydrateOptions));
    restored.clear();
    await metadata.setItem("account", JSON.stringify({ ...identity, buster }));
    if (epoch !== expected) return;
    unsubscribe = persistQueryClientSubscribe(options);
  }
  async function restore(revision?: number): Promise<T | undefined> {
    const expected = epoch;
    const raw = await metadata.getItem("account");
    if (!raw || expected !== epoch) return;
    const identity = JSON.parse(raw) as T & { buster: string };
    if (
      identity.buster !== buster ||
      !identity.user.emailVerified ||
      identity.expiresAt <= Date.now() ||
      identity.revision !== revision
    ) {
      await erase();
      return;
    }
    await accept(identity);
    return accepted;
  }
  return { accept, erase, restore };
}
