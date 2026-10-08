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
});
