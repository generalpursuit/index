import type { Query, QueryClient } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import {
  persistQueryClientRestore,
  persistQueryClientSave,
  persistQueryClientSubscribe,
} from "@tanstack/query-persist-client-core";
import { cacheMaxAge } from "./client";
import type { ContentStorage } from "./storage";
import { contentFeatures } from "./content";

type Identity = {
  user: { id: string; emailVerified: boolean };
  expiresAt: number;
  revision?: number;
};
function hasDraft(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return item.delivery === "pending" || item.pending === true || Object.values(item).some(hasDraft);
}
export function persistContent(query: Query, account: string) {
  const [path, options] = query.queryKey as [
    string[],
    { input?: { query?: string }; type?: string },
  ];
  return (
    Array.isArray(path) &&
    path[0] === "viewer" &&
    path[1] === account &&
    contentFeatures.has(path[2]!) &&
    !query.queryKey.includes("pulse") &&
    path[3] !== "searchUsers" &&
    !options?.input?.query &&
    query.state.status === "success" &&
    !hasDraft(query.state.data) &&
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
  let ready = false;
  let unsubscribe: (() => void) | undefined;
  let epoch = 0;
  let flush: (() => Promise<void>) | undefined;
  const mutations = cache.getMutationCache();
  const settled = mutations.config.onSettled;
  mutations.config.onSettled = async (...args) => {
    await settled?.(...args);
    if (cache.isMutating() === 1) await flush?.().catch(() => {});
  };
  let erasing: Promise<unknown> = Promise.resolve();
  const storage = (id: string) => storageFor(`index.content.${origin}.${id}`);
  async function erase(prior = accepted) {
    ++epoch;
    unsubscribe?.();
    unsubscribe = undefined;
    flush = undefined;
    accepted = undefined;
    ready = false;
    if (!prior) return erasing;
    // Queue deletion after any already-started transaction, before a new account can bind.
    erasing = erasing
      .catch(() => {})
      .then(async () => {
        const marker = await metadata.getItem("account").catch(() => null);
        const saved = marker ? (JSON.parse(marker) as T) : undefined;
        // A peer tab may already have accepted another account. Never erase its marker.
        await Promise.allSettled([
          saved?.user.id === prior.user.id && saved.revision === prior.revision
            ? metadata.removeItem("account")
            : Promise.resolve(),
          storage(prior.user.id).removeItem("cache"),
        ]);
      })
      .catch(() => {});
    return erasing;
  }
  async function accept(identity: T) {
    if (!identity.user.emailVerified) {
      await erase();
      return;
    }
    if (accepted?.user.id === identity.user.id && accepted.revision === identity.revision) {
      const marker = await metadata.getItem("account");
      const saved = marker ? (JSON.parse(marker) as T) : undefined;
      if (saved?.user.id === identity.user.id && saved.revision === identity.revision) {
        accepted = identity;
        await metadata.setItem("account", JSON.stringify({ ...identity, buster }));
      } else await erase();
      return;
    }
    const before = epoch;
    if (accepted) await erase();
    else {
      const marker = await metadata.getItem("account");
      if (epoch !== before) return;
      if (marker && (JSON.parse(marker) as T).user.id !== identity.user.id)
        await erase(JSON.parse(marker) as T);
    }
    const waiting = epoch;
    await erasing;
    if (waiting !== epoch) return;
    const expected = ++epoch;
    accepted = identity;
    const underlying = storage(identity.user.id);
    let latestWrite = 0;
    const guarded: ContentStorage = {
      getItem: async (key) => (expected === epoch ? underlying.getItem(key) : null),
      setItem: async (key, value) => {
        const timestamp = (JSON.parse(value) as { timestamp: number }).timestamp;
        const marker = await metadata.getItem("account");
        const saved = marker ? (JSON.parse(marker) as T & { buster: string }) : undefined;
        if (
          expected === epoch &&
          timestamp >= latestWrite &&
          saved?.user.id === identity.user.id &&
          saved.revision === identity.revision &&
          saved.buster === buster
        ) {
          latestWrite = timestamp;
          await underlying.setItem(key, value);
        }
      },
      removeItem: (key) => underlying.removeItem(key),
    };
    const throttled = createAsyncStoragePersister({
      storage: guarded,
      key: "cache",
      throttleTime: 1000,
    });
    const persister = {
      ...throttled,
      // Optimistic bubbles and comments are still drafts until the server accepts them.
      persistClient: (client: Parameters<typeof throttled.persistClient>[0]) =>
        cache.isMutating() ? Promise.resolve() : throttled.persistClient(client),
    };
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
    // A completed edit must survive an immediate reload. Delayed older snapshots cannot overwrite it.
    const immediate = createAsyncStoragePersister({
      storage: guarded,
      key: "cache",
      throttleTime: 0,
    });
    flush = () => persistQueryClientSave({ ...options, persister: immediate });
    ready = true;
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
      await erase(identity);
      return;
    }
    await accept(identity);
    return ready ? accepted : undefined;
  }
  return {
    accept: async (identity: T) => {
      try {
        await accept(identity);
        return (
          ready && accepted?.user.id === identity.user.id && accepted.revision === identity.revision
        );
      } catch {
        await erase();
        return false;
      }
    },
    erase: () => erase(),
    restore: async (revision?: number) => {
      try {
        return await restore(revision);
      } catch {
        await erase();
        return undefined;
      }
    },
  };
}
