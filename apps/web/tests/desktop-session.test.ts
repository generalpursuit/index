import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createNativeSessionFetch } from "../src/lib/desktop/session-fetch";

describe("desktop bearer transport", () => {
  test("restores, rotates and erases credentials without cookies", async () => {
    let token: string | null = "first.signed";
    const transport = createNativeSessionFetch(
      "https://api.example.com",
      {
        read: async () => token,
        write: async (next) => {
          token = next;
        },
      },
      (async (_input, init) => {
        assert.equal(init?.credentials, "omit");
        assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer " + token);
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
      {
        read: async () => "signed",
        write: async () => {},
      },
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
      {
        read: async () => "signed",
        write: async () => {
          erased = true;
        },
      },
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
      {
        read: async () => token,
        write: async (next) => {
          token = next;
        },
      },
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
      {
        read: async () => token,
        write: async (next) => {
          token = next;
        },
      },
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
    {
      read: async () => token,
      write: async (next) => {
        token = next;
      },
    },
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
    {
      read: async () => token,
      write: async (next) => {
        if (next === "old.rotation") {
          started();
          await held;
        }
        token = next;
        writes.push(next);
      },
    },
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
