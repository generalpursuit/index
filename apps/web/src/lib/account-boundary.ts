import type { MutationFunctionContext, MutationOptions, QueryClient } from "@tanstack/react-query";

const clearListeners = new Set<() => void>();
export function onAccountClear(listener: () => void) {
  clearListeners.add(listener);
  return () => {
    clearListeners.delete(listener);
  };
}
let generation = 0;
export const accountGeneration = () => generation;
export function assertCurrentAccount(expected: number) {
  if (expected !== generation) throw new DOMException("Session changed", "AbortError");
}

/** Keep active session observers attached, but synchronously discard the previous identity. */
export function clearAccountState(client: QueryClient, keepSessionRequest = false) {
  generation++;
  for (const listener of clearListeners) listener();
  const cancelled = client.cancelQueries({
    predicate: (query) => !keepSessionRequest || query.queryKey[0] !== "session",
  });
  client.setQueryData(["session"], null);
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" });
  client.getMutationCache().clear();
  return cancelled;
}

// TanStack passes the same MutationFunctionContext to each callback of an attempt. Keeping
// its generation here also survives an observer updating its options during a re-render.
const attempts = new WeakMap<MutationFunctionContext, number>();
function current(context: MutationFunctionContext) {
  return attempts.get(context) === generation;
}

/** A late result or optimistic rollback must not recreate another account's cache. */
export function accountMutationOptions<TData, TError, TVariables, TContext>(
  options: MutationOptions<TData, TError, TVariables, TContext>,
): MutationOptions<TData, TError, TVariables, TContext | undefined> {
  return {
    ...options,
    onMutate: (variables, context) => {
      attempts.set(context, generation);
      return options.onMutate?.(variables, context);
    },
    mutationFn: async (variables, context) => {
      const expected = attempts.get(context);
      if (expected === undefined) throw new DOMException("Session changed", "AbortError");
      assertCurrentAccount(expected);
      try {
        return await options.mutationFn!(variables, context);
      } finally {
        assertCurrentAccount(expected);
      }
    },
    onSuccess: (data, variables, result, context) =>
      current(context)
        ? options.onSuccess?.(data, variables, result as TContext, context)
        : undefined,
    onError: (error, variables, result, context) =>
      current(context) ? options.onError?.(error, variables, result, context) : undefined,
    onSettled: (data, error, variables, result, context) =>
      current(context) ? options.onSettled?.(data, error, variables, result, context) : undefined,
  };
}
