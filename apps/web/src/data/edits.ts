import type { QueryClient, QueryKey } from "@tanstack/react-query";
import {
  accountGeneration,
  accountMutationOptions,
  assertCurrentAccount,
} from "@/lib/account-boundary";

type Patch = (data: unknown, key: QueryKey) => unknown;
type Edit = { patch: Patch };
type Layer = {
  generation: number;
  base: Map<string, { key: QueryKey; data: unknown }>;
  edits: Edit[];
};
const layers = new WeakMap<QueryClient, Map<string, Layer>>();

/** Replay overlapping edits over their shared base, so one rollback cannot erase another edit. */
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
    if (data === undefined)
      cache.getQueryCache().find({ queryKey, exact: true })?.setState({
        data: undefined,
        dataUpdatedAt: 0,
        error: null,
        status: "pending",
      });
    else cache.setQueryData(queryKey, data);
  };
  const replay = (layer: Layer) => {
    for (const entry of layer.base.values()) {
      let data = entry.data;
      for (const edit of layer.edits) data = edit.patch(data, entry.key);
      write(entry.key, data);
    }
  };
  const completeDestinations = (layer: Layer) => {
    if (cache.isMutating({ mutationKey: key }) !== 1) return;
    // A destination opened during the write may have read the server's previous value.
    for (const query of cache.getQueryCache().findAll({
      predicate: (query) => affects(query.queryKey) && !layer.base.has(query.queryHash),
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
      await cache.cancelQueries({ predicate: (query) => affects(query.queryKey) });
      assertCurrentAccount(generation);
      let groups = layers.get(cache);
      if (!groups) layers.set(cache, (groups = new Map()));
      let layer = groups.get(group);
      if (!layer || layer.generation !== generation)
        groups.set(group, (layer = { generation, base: new Map(), edits: [] }));
      for (const query of cache
        .getQueryCache()
        .findAll({ predicate: (query) => affects(query.queryKey) }))
        if (!layer.base.has(query.queryHash))
          layer.base.set(query.queryHash, { key: query.queryKey, data: query.state.data });
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
  const object = data as Record<string, unknown>;
  if (match(object)) return change(object);
  return Object.fromEntries(
    Object.entries(object).map(([key, value]) => [key, mapItems(value, match, change)]),
  );
}
