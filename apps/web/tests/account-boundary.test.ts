import { test } from "node:test";
import assert from "node:assert/strict";
import { MutationObserver, QueryClient, QueryObserver } from "@tanstack/react-query";
import { accountMutationOptions, clearAccountState } from "../src/lib/account-boundary";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const alice = { user: { id: "alice", emailVerified: true } };
const bob = { user: { id: "bob", emailVerified: true } };

test("successful sign-out followed by failed revalidation retains the observer but clears identity", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["session"], alice);
  client.setQueryData(["private"], { secret: "alice" });
  const options = {
    queryKey: ["session"],
    queryFn: async () => {
      throw new Error("offline");
    },
    staleTime: Infinity,
  };
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  const query = observer.getCurrentQuery();
  await clearAccountState(client);
  await assert.rejects(client.fetchQuery({ ...options, staleTime: 0 }), /offline/);
  assert.equal(observer.getCurrentQuery(), query);
  assert.equal(observer.getCurrentResult().data, null);
  assert.equal(client.getQueryData(["private"]), undefined);
  assert.equal(client.getMutationCache().getAll().length, 0);
  unsubscribe();
  client.clear();
});

test("signup updates a login observer which stays mounted through the transition", async () => {
  const client = new QueryClient();
  const restricted = { user: { id: "new", emailVerified: false } };
  const options = { queryKey: ["session"], queryFn: async () => restricted, staleTime: Infinity };
  client.setQueryData(options.queryKey, null);
  const observer = new QueryObserver(client, options);
  const seen: unknown[] = [];
  const unsubscribe = observer.subscribe((result) => {
    seen.push(result.data);
  });
  const query = observer.getCurrentQuery();
  await clearAccountState(client);
  await client.fetchQuery({ ...options, staleTime: 0 });
  assert.equal(observer.getCurrentQuery(), query);
  assert.deepEqual(observer.getCurrentResult().data, restricted);
  assert.ok(seen.includes(restricted));
  unsubscribe();
  client.clear();
});

for (const outcome of ["success", "failure"] as const) {
  test(`account switch drops pending queries and mutations, including late ${outcome} callbacks`, async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["session"], alice);
    const response = deferred<string>();
    const oldQuery = client.fetchQuery({
      queryKey: ["alice", "private"],
      queryFn: () => response.promise,
    });
    const oldQueryResult = oldQuery.catch(() => {});
    const started = deferred<void>();
    let callbackRan = false;
    const observer = new MutationObserver(
      client,
      accountMutationOptions({
        mutationFn: async () => {
          started.resolve();
          const result = await response.promise;
          if (outcome === "failure") throw new Error("old failure");
          return result;
        },
        onMutate: () => ({ secret: "alice's draft" }),
        onSuccess: (value) => {
          callbackRan = true;
          client.setQueryData(["saved"], value);
        },
        onError: (_error, _variables, context) => {
          callbackRan = true;
          client.setQueryData(["saved"], context);
        },
        onSettled: () => {
          callbackRan = true;
        },
      }),
    );
    const oldMutation = observer.mutate(undefined).catch(() => {});
    await started.promise;
    await clearAccountState(client);
    client.setQueryData(["session"], bob);
    response.resolve("alice's late response");
    await Promise.all([oldMutation, oldQueryResult]);
    assert.deepEqual(client.getQueryData(["session"]), bob);
    assert.equal(client.getQueryData(["saved"]), undefined);
    assert.equal(client.getQueryData(["alice", "private"]), undefined);
    assert.equal(client.getMutationCache().getAll().length, 0);
    assert.equal(callbackRan, false);
    client.clear();
  });
}

test("a held restricted-session response body cannot reset a newer browser account", async () => {
  const { createSessionEventFetch } = await import("../src/lib/session-events");
  const client = new QueryClient();
  client.setQueryData(["session"], alice);
  let release!: () => void;
  let started!: () => void;
  const headers = new Promise<void>((resolve) => {
    started = resolve;
  });
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"data":'));
      release = () => {
        controller.enqueue(new TextEncoder().encode('{"code":"EMAIL_NOT_VERIFIED"}}'));
        controller.close();
      };
    },
  });
  const events: string[] = [];
  const transport = createSessionEventFetch(
    (async () => {
      started();
      return new Response(stream, { status: 403 });
    }) as typeof fetch,
    (event) => {
      events.push(event);
      void clearAccountState(client);
    },
  );
  const old = transport("https://api.example.com/rpc/v1/profiles/me");
  await headers;
  // Yield until the response header check has passed and the JSON body is pending.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await clearAccountState(client);
  client.setQueryData(["session"], bob);
  release();
  await assert.rejects(old, /Session changed/);
  assert.deepEqual(events, []);
  assert.deepEqual(client.getQueryData(["session"]), bob);
  client.clear();
});

test("both oRPC envelopes and REST errors signal current-session verification", async () => {
  const { createSessionEventFetch } = await import("../src/lib/session-events");
  for (const body of [
    { data: { code: "EMAIL_NOT_VERIFIED" } },
    { json: { data: { code: "EMAIL_NOT_VERIFIED" } } },
  ]) {
    const events: string[] = [];
    const transport = createSessionEventFetch(
      (async () => Response.json(body, { status: 403 })) as typeof fetch,
      (event) => {
        events.push(event);
      },
    );
    await transport("https://api.example.com/rpc/v1/routes/resolve");
    assert.deepEqual(events, ["index:verification-required"]);
  }
});
