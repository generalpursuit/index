import { replaceEqualDeep, type QueryClient, type QueryKey } from "@tanstack/react-query";
import {
  accountGeneration,
  accountMutationOptions,
  assertCurrentAccount,
} from "@/lib/account-boundary";

type Patch = (data: unknown, key: QueryKey) => unknown;
type Edit = { patch: Patch };
type Layer = {
  generation: number;
  affects: (key: QueryKey) => boolean;
  base: Map<string, { key: QueryKey; data: unknown; applied: unknown }>;
  edits: Edit[];
};
const layers = new WeakMap<QueryClient, Map<string, Layer>>();

const revisions = new WeakMap<QueryClient, number>();
export const editRevision = (cache: QueryClient) => revisions.get(cache) ?? 0;
export const hasEdits = (cache: QueryClient, key: QueryKey) =>
  [...(layers.get(cache)?.values() ?? [])].some(
    (layer) =>
      layer.generation === accountGeneration() && layer.edits.length > 0 && layer.affects(key),
  );
function advanceRevision(cache: QueryClient) {
  revisions.set(cache, editRevision(cache) + 1);
}

const same = (a: unknown, b: unknown) => replaceEqualDeep(a, b) === a;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Undo only our changes that are still present. Reads can add items or change fields meanwhile. */
function undo(current: unknown, before: unknown, applied: unknown): unknown {
  if (same(before, applied)) return current;
  if (same(current, applied)) return before;
  if (Array.isArray(current) && Array.isArray(before) && Array.isArray(applied)) {
    if (
      [...current, ...before, ...applied].every(
        (item) => object(item) && typeof item.id === "string",
      )
    ) {
      const prior = new Map(before.map((item) => [item.id, item]));
      const written = new Map(applied.map((item) => [item.id, item]));
      const result = current.flatMap((item) => {
        if (!written.has(item.id)) return [item];
        if (!prior.has(item.id)) return same(item, written.get(item.id)) ? [] : [item];
        return [undo(item, prior.get(item.id), written.get(item.id))];
      });
      for (let index = 0; index < before.length; index++) {
        const item = before[index];
        if (written.has(item.id) || result.some((entry) => object(entry) && entry.id === item.id))
          continue;
        const next = before
          .slice(index + 1)
          .find((entry) => result.some((value) => object(value) && value.id === entry.id));
        const position = next
          ? result.findIndex((value) => object(value) && value.id === next.id)
          : result.length;
        result.splice(position, 0, item);
      }
      return result;
    }
    return current.map((item, index) =>
      index < before.length && index < applied.length
        ? undo(item, before[index], applied[index])
        : item,
    );
  }
  if (object(current) && object(before) && object(applied)) {
    const result = { ...current };
    for (const key of new Set([...Object.keys(before), ...Object.keys(applied)])) {
      if (same(before[key], applied[key])) continue;
      const value = undo(current[key], before[key], applied[key]);
      if (value === undefined) delete result[key];
      else result[key] = value;
    }
    return result;
  }
  return current;
}

/** Related edits share a layer, but each replay starts with current server data. */
export function instantEdit<TData, TVariables>(
  cache: QueryClient,
  {
    key,
    mutationFn,
    affects,
    optimistic,
    response,
    invalidate,
  }: {
    key: QueryKey;
    mutationFn: (input: TVariables) => Promise<TData>;
    affects: (key: QueryKey) => boolean;
    optimistic: (input: TVariables) => Patch;
    response?: (data: TData, input: TVariables) => Patch;
    invalidate?: () => void;
  },
) {
  const group = JSON.stringify(key);
  const write = (queryKey: QueryKey, data: unknown) => {
    const query = cache.getQueryCache().find({ queryKey, exact: true });
    if (!query || query.state.data === undefined) return;
    // Null hides an intentionally removed item without resetting its query/error state.
    const next = replaceEqualDeep(query.state.data, data === undefined ? null : data);
    if (next !== query.state.data)
      cache.setQueryData(queryKey, next, {
        updatedAt: next === null ? 0 : query.state.dataUpdatedAt,
      });
  };
  const replay = (layer: Layer) => {
    for (const entry of layer.base.values()) {
      const current = cache.getQueryData(entry.key);
      if (current === undefined) continue;
      entry.data = undo(current, entry.data, entry.applied);
      let data = entry.data;
      for (const edit of layer.edits) data = edit.patch(data, entry.key);
      write(entry.key, data);
      entry.applied = cache.getQueryData(entry.key);
    }
  };
  const completeDestinations = (layer: Layer) => {
    if (cache.isMutating({ mutationKey: key }) !== 1) return;
    // A destination opened during the write may have read the server's previous value.
    for (const query of cache.getQueryCache().findAll({
      predicate: (query) =>
        affects(query.queryKey) &&
        !layer.base.has(query.queryHash) &&
        query.state.data !== undefined,
    })) {
      let data = query.state.data;
      for (const edit of layer.edits) data = edit.patch(data, query.queryKey);
      write(query.queryKey, data);
    }
  };
  return accountMutationOptions<TData, Error, TVariables, { layer: Layer; edit: Edit }>({
    mutationKey: key,
    mutationFn: (input) => mutationFn(input),
    onMutate: async (input) => {
      const generation = accountGeneration();
      await cache.cancelQueries({
        predicate: (query) => affects(query.queryKey) && query.state.data !== undefined,
      });
      assertCurrentAccount(generation);
      advanceRevision(cache);
      let groups = layers.get(cache);
      if (!groups) layers.set(cache, (groups = new Map()));
      let layer = groups.get(group);
      if (!layer || layer.generation !== generation)
        groups.set(group, (layer = { generation, affects, base: new Map(), edits: [] }));
      for (const query of cache.getQueryCache().findAll({
        predicate: (query) => affects(query.queryKey) && query.state.data !== undefined,
      }))
        if (!layer.base.has(query.queryHash))
          layer.base.set(query.queryHash, {
            key: query.queryKey,
            data: query.state.data,
            applied: query.state.data,
          });
      const edit = { patch: optimistic(input) };
      layer.edits.push(edit);
      replay(layer);
      return { layer, edit };
    },
    onSuccess: (data, input, context) => {
      if (!context) return;
      if (response) context.edit.patch = response(data, input);
      replay(context.layer);
      completeDestinations(context.layer);
    },
    onError: (_error, _input, context) => {
      if (!context) return;
      context.layer.edits = context.layer.edits.filter((edit) => edit !== context.edit);
      replay(context.layer);
      completeDestinations(context.layer);
    },
    onSettled: () => {
      advanceRevision(cache);
      if (cache.isMutating({ mutationKey: key }) === 1) {
        layers.get(cache)?.delete(group);
        invalidate?.();
      }
    },
  });
}

export function viewerPath(key: QueryKey, viewerId: string | null, ...features: string[]) {
  const path = key[0];
  return (
    Array.isArray(path) &&
    path[0] === "viewer" &&
    path[1] === (viewerId ?? "anonymous") &&
    features.includes(path[2])
  );
}
/** Transform response trees without teaching the data layer any feature's payload shape. */
export function mapItems(
  data: unknown,
  match: (item: Record<string, unknown>) => boolean,
  change: (item: Record<string, unknown>) => unknown,
): unknown {
  if (Array.isArray(data))
    return data.map((item) => mapItems(item, match, change)).filter((item) => item !== undefined);
  if (!data || typeof data !== "object") return data;
  // Only plain data is walked; a Blob or Date has no items and would come back as `{}`.
  const prototype = Object.getPrototypeOf(data);
  if (prototype !== Object.prototype && prototype !== null) return data;
  const object = data as Record<string, unknown>;
  if (match(object)) return change(object);
  return Object.fromEntries(
    Object.entries(object).map(([key, value]) => [key, mapItems(value, match, change)]),
  );
}
