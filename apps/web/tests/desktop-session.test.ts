import { nativeSessionStore } from "./native-session-store";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createNativeSessionFetch as createTransport } from "../src/lib/desktop/session-fetch";

// Ordinary fixture requests begin after the window accepted fixture revision 0.
function createNativeSessionFetch(...args: Parameters<typeof createTransport>) {
  const transport = createTransport(...args);
  transport.acceptSession(0);
  return transport;
}

describe("desktop bearer transport", () => {
  test("restores, rotates and erases credentials without cookies", async () => {
    let token: string | null = "first.signed";
    const transport = createNativeSessionFetch(
      "https://api.example.com",
      nativeSessionStore({
        read: async () => token,
        write: async (next) => {
          token = next;
        },
      }),
      (async (_input, init) => {
        assert.equal(init?.credentials, "omit");
        const logout = new Request(_input).url.endsWith("/sign-out");
        assert.equal(
          new Headers(init?.headers).get("Authorization"),
          "Bearer " + (logout ? "next.signed" : token),
        );
        if (logout) assert.equal(token, null);
        return new Response('{"success":true}', { headers: { "set-auth-token": "next.signed" } });
      }) as typeof fetch,
    );
    await transport("https://api.example.com/rpc/v1/profiles/me");
    assert.equal(token, "next.signed");
    await transport("https://api.example.com/api/auth/sign-out", { method: "POST" });
    assert.equal(token, null);
  });
  test("never sends the token to another host or follows a redirect", async () => {
    const transport = createNativeSessionFetch(
      "https://api.example.com",
      nativeSessionStore({
        read: async () => "signed",
        write: async () => {},
      }),
      (async (_input, init) => {
        assert.equal(init?.redirect, "error");
        return new Response("{}");
      }) as typeof fetch,
    );
    await assert.rejects(transport("https://other.example.com/rpc"), /configured API/);
    await transport("https://api.example.com/rpc");
  });
  test("offline logout still clears the keychain", async () => {
    let erased = false;
    const transport = createNativeSessionFetch(
      "https://api.example.com",
      nativeSessionStore({
        read: async () => "signed",
        write: async () => {
          erased = true;
        },
      }),
      (async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch,
    );
    await assert.rejects(
      transport("https://api.example.com/api/auth/sign-out", { method: "POST" }),
      /offline/,
    );
    assert.equal(erased, true);
  });
  test("null session clears stale credentials", async () => {
    let token: string | null = "expired";
    const transport = createNativeSessionFetch(
      "https://api.example.com",
      nativeSessionStore({
        read: async () => token,
        write: async (next) => {
          token = next;
        },
      }),
      (async () => new Response("null")) as unknown as typeof fetch,
    );
    await transport("https://api.example.com/api/auth/get-session");
    assert.equal(token, null);
  });
  test("username login clears the prior credential and ignores its late private responses", async () => {
    let token: string | null = "alice.signed";
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transport = createNativeSessionFetch(
      "https://api.example.com",
      nativeSessionStore({
        read: async () => token,
        write: async (next) => {
          token = next;
        },
      }),
      (async (input, init) => {
        if (new Request(input).url.endsWith("/sign-in/username")) {
          assert.equal(new Headers(init?.headers).get("Authorization"), null);
          return new Response("{}", { headers: { "set-auth-token": "bob.signed" } });
        }
        await pending;
        return new Response("{}");
      }) as typeof fetch,
    );
    const old = transport("https://api.example.com/api/v1/me/profile");
    // Start the old request before changing accounts, without waiting on its network.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await transport("https://api.example.com/api/auth/sign-in/username", { method: "POST" });
    release();
    await assert.rejects(old, /Session changed/);
    assert.equal(token, "bob.signed");
  });
});

test("an old null-session body cannot erase the newer signed credential", async () => {
  let token: string | null = "alice.signed";
  let finish!: () => void;
  let started!: () => void;
  const headersReady = new Promise<void>((resolve) => {
    started = resolve;
  });
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("nu"));
      finish = () => {
        controller.enqueue(new TextEncoder().encode("ll"));
        controller.close();
      };
    },
  });
  let expired = 0;
  const transport = createNativeSessionFetch(
    "https://api.example.com",
    nativeSessionStore({
      read: async () => token,
      write: async (next) => {
        token = next;
      },
    }),
    (async (input) => {
      if (new Request(input).url.endsWith("/get-session")) {
        started();
        return new Response(body);
      }
      return new Response("{}", { headers: { "set-auth-token": "bob.signed" } });
    }) as typeof fetch,
    () => {
      expired++;
    },
  );
  const old = transport("https://api.example.com/api/auth/get-session");
  await headersReady;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await transport("https://api.example.com/api/auth/sign-in/username", { method: "POST" });
  finish();
  await assert.rejects(old, /Session changed/);
  assert.equal(token, "bob.signed");
  assert.equal(expired, 0);
});

test("a delayed serialized credential write cannot restore an old in-memory token", async () => {
  let token: string | null = "alice.signed";
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const writing = new Promise<void>((resolve) => {
    started = resolve;
  });
  const writes: (string | null)[] = [];
  const transport = createNativeSessionFetch(
    "https://api.example.com",
    nativeSessionStore({
      read: async () => token,
      write: async (next) => {
        if (next === "old.rotation") {
          started();
          await held;
        }
        token = next;
        writes.push(next);
      },
    }),
    (async (input, init) => {
      const login = new Request(input).url.endsWith("/sign-in/username");
      if (login) assert.equal(new Headers(init?.headers).get("Authorization"), null);
      return new Response("{}", {
        headers: { "set-auth-token": login ? "bob.signed" : "old.rotation" },
      });
    }) as typeof fetch,
  );
  const old = transport("https://api.example.com/rpc/v1/profiles/me").catch((error) => error);
  await writing;
  const login = transport("https://api.example.com/api/auth/sign-in/username", { method: "POST" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  release();
  await login;
  assert.match((await old).message, /Session changed/);
  assert.deepEqual(writes, ["old.rotation", null, "bob.signed"]);
  assert.equal(token, "bob.signed");
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("two windows discard a held private body and never restore its rotated credential", async () => {
  let token: string | null = "alice.signed";
  const store = nativeSessionStore({
    read: async () => token,
    write: async (value) => {
      token = value;
    },
  });
  const bodyStarted = deferred(),
    release = deferred();
  const menu = createNativeSessionFetch("https://api.example.com", store, (async () => {
    const body = new ReadableStream({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode('{"private":'));
        bodyStarted.resolve();
        await release.promise;
        controller.enqueue(new TextEncoder().encode('"alice"}'));
        controller.close();
      },
    });
    return new Response(body, { headers: { "set-auth-token": "alice.rotated" } });
  }) as typeof fetch);
  const main = createNativeSessionFetch(
    "https://api.example.com",
    store,
    (async () =>
      new Response("{}", { headers: { "set-auth-token": "bob.signed" } })) as typeof fetch,
  );
  const old = menu("https://api.example.com/rpc/v1/links/list").catch((e) => e);
  await bodyStarted.promise;
  await main("https://api.example.com/api/auth/sign-in/email", { method: "POST" });
  release.resolve();
  assert.equal((await old).name, "AbortError");
  assert.equal(token, "bob.signed");
});

test("a late 401 and a late offline logout in another window cannot erase a new login", async () => {
  for (const logout of [false, true]) {
    let token: string | null = "alice.signed";
    const store = nativeSessionStore({
      read: async () => token,
      write: async (value) => {
        token = value;
      },
    });
    const started = deferred(),
      release = deferred();
    let expired = 0;
    const menu = createNativeSessionFetch(
      "https://api.example.com",
      store,
      (async () => {
        started.resolve();
        await release.promise;
        if (logout) throw new Error("offline");
        return new Response("{}", { status: 401 });
      }) as typeof fetch,
      () => {
        expired++;
      },
    );
    const main = createNativeSessionFetch(
      "https://api.example.com",
      store,
      (async () =>
        new Response("{}", { headers: { "set-auth-token": "bob.signed" } })) as typeof fetch,
    );
    const old = menu("https://api.example.com/" + (logout ? "api/auth/sign-out" : "rpc/v1/links"), {
      method: "POST",
    }).catch((e) => e);
    await started.promise;
    await main("https://api.example.com/api/auth/sign-in/username", { method: "POST" });
    release.resolve();
    await old;
    assert.equal(token, "bob.signed");
    assert.equal(expired, 0);
  }
});

test("CAS rejects a queued stale credential write after another window signs out", async () => {
  let token: string | null = "alice.signed";
  const store = nativeSessionStore({
    read: async () => token,
    write: async (value) => {
      token = value;
    },
  });
  const old = await store.read();
  await store.write(null, old.revision);
  await assert.rejects(store.write("alice.rotated", old.revision), /Session changed/);
  assert.equal(token, null);
});

test("a held native write serializes reads and both windows without restoring an old response", async () => {
  let token: string | null = "alice.signed";
  const held = deferred(),
    started = deferred();
  const store = nativeSessionStore({
    read: async () => token,
    write: async (value) => {
      if (value === "alice.rotated") {
        started.resolve();
        await held.promise;
      }
      token = value;
    },
  });
  const old = await store.read();
  const write = store.write("alice.rotated", old.revision);
  await started.promise;
  let readDone = false;
  const read = store.read().then((value) => {
    readDone = true;
    return value;
  });
  await Promise.resolve();
  assert.equal(readDone, false);
  held.resolve();
  await write;
  const snapshot = await read;
  await store.write(null, snapshot.revision);
  await store.write("bob.signed", await store.revision());
  await assert.rejects(store.write("alice.signed", snapshot.revision), /Session changed/);
  assert.equal(token, "bob.signed");
});

test("same-token verification advances the shared revision and carries no credential change", async () => {
  let token: string | null = "restricted.signed";
  let writes = 0;
  const store = nativeSessionStore({
    read: async () => token,
    write: async (value) => {
      token = value;
      writes++;
    },
  });
  const transport = createNativeSessionFetch(
    "https://api.example.com",
    store,
    (async () => new Response("{}")) as typeof fetch,
  );
  await transport("https://api.example.com/api/auth/security/verify-email", { method: "POST" });
  assert.equal(await store.revision(), 1);
  assert.equal(token, "restricted.signed");
  assert.equal(writes, 0);
});

test("a stalled window cannot submit its old draft or sign out a newer account before peer events arrive", async () => {
  for (const path of ["/api/v1/links/share", "/api/auth/sign-out", "/rpc/v1/groups/create"]) {
    let token: string | null = "alice.signed";
    const store = nativeSessionStore({
      read: async () => token,
      write: async (value) => {
        token = value;
      },
    });
    let mutations = 0,
      stale = 0,
      checked = -1;
    const panel = createTransport(
      "https://api.example.com",
      store,
      (async (input) => {
        if (!new Request(input).url.endsWith("/get-session")) mutations++;
        return new Response('{"user":{"id":"alice","emailVerified":true}}');
      }) as typeof fetch,
      () => {},
      (revision) => {
        checked = revision;
      },
      () => {
        stale++;
      },
    );
    await panel("https://api.example.com/api/auth/get-session");
    panel.acceptSession(checked);
    const main = createTransport(
      "https://api.example.com",
      store,
      (async () =>
        new Response("{}", { headers: { "set-auth-token": "bob.signed" } })) as typeof fetch,
    );
    await main("https://api.example.com/api/auth/sign-in/email", { method: "POST" });
    // Deliberately do not deliver any peer event or refresh the panel's session.
    await assert.rejects(
      panel("https://api.example.com" + path, {
        method: "POST",
        body: '{"url":"https://alice-private-draft.example"}',
      }),
      { name: "AbortError" },
    );
    assert.equal(mutations, 0);
    assert.equal(token, "bob.signed");
    assert.equal(stale, 1);
  }
});

test("bootstrap and refreshed get-session require UI acceptance before ordinary application requests", async () => {
  let token: string | null = "alice.signed";
  const store = nativeSessionStore({
    read: async () => token,
    write: async (value) => {
      token = value;
    },
  });
  let checked = -1,
    calls = 0;
  const panel = createTransport(
    "https://api.example.com",
    store,
    (async () => {
      calls++;
      return new Response("{}");
    }) as typeof fetch,
    () => {},
    (revision) => {
      checked = revision;
    },
  );
  await assert.rejects(panel("https://api.example.com/rpc/v1/links/share", { method: "POST" }), {
    name: "AbortError",
  });
  assert.equal(calls, 0);
  await panel("https://api.example.com/api/auth/get-session");
  await assert.rejects(panel("https://api.example.com/rpc/v1/links/share", { method: "POST" }), {
    name: "AbortError",
  });
  panel.acceptSession(checked);
  await panel("https://api.example.com/rpc/v1/links/share", { method: "POST" });
  assert.equal(calls, 2);
});

test("local sign-out erases and notifies before held auth network or response body finishes", async () => {
  for (const holdBody of [false, true]) {
    let token: string | null = "alice.signed",
      cleared = 0;
    const store = nativeSessionStore({
      read: async () => token,
      write: async (value) => {
        token = value;
      },
    });
    const started = deferred(),
      release = deferred();
    const main = createTransport(
      "https://api.example.com",
      store,
      (async (_input, init) => {
        assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer alice.signed");
        assert.equal(token, null);
        assert.equal(cleared, 1);
        started.resolve();
        if (!holdBody) {
          await release.promise;
          return new Response("{}");
        }
        return new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(new TextEncoder().encode("{"));
              await release.promise;
              controller.enqueue(new TextEncoder().encode("}"));
              controller.close();
            },
          }),
        );
      }) as typeof fetch,
      () => {},
      () => {},
      () => {},
      () => {
        cleared++;
      },
    );
    main.acceptSession(0);
    const logout = main("https://api.example.com/api/auth/sign-out", { method: "POST" }).catch(
      (e) => e,
    );
    await started.promise;
    assert.equal((await store.read()).token, null);
    // A new sign-in is allowed while old server revocation is still held.
    const other = createTransport(
      "https://api.example.com",
      store,
      (async () =>
        new Response("{}", { headers: { "set-auth-token": "bob.signed" } })) as typeof fetch,
    );
    await other("https://api.example.com/api/auth/sign-in/email", { method: "POST" });
    release.resolve();
    assert.equal((await logout).name, "AbortError");
    assert.equal(token, "bob.signed");
    assert.equal(cleared, 1);
  }
});
