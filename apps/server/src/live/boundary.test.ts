import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../app";
import { socketAddress } from "./address";

test("socket tickets retain native API aliases, custom origins and development ports", () => {
  assert.equal(
    socketAddress(
      "https://index-production-api.generalpursuit.workers.dev/api/v1/me/live/ticket",
      "alice",
      "proof",
    ),
    "wss://index-production-api.generalpursuit.workers.dev/live/alice?ticket=proof",
  );
  assert.equal(
    socketAddress("https://api.index.example/rpc/v1/live/ticket", "alice", "proof"),
    "wss://api.index.example/live/alice?ticket=proof",
  );
  assert.equal(
    socketAddress("http://localhost:8080/api/v1/me/live/ticket", "alice", "proof"),
    "ws://localhost:8080/live/alice?ticket=proof",
  );
});

test("socket upgrades enforce browser origins and never create database/auth context", async () => {
  let forwarded = 0;
  const app = createApp({
    origins: ["https://index.example"],
    auth: async () => {
      throw new Error("Upgrade must not resolve auth");
    },
    createContext: async () => {
      throw new Error("Upgrade must not create API context");
    },
    readMedia: async () => null,
    connect: async (account, request) => {
      assert.equal(account, "alice");
      assert.equal(new URL(request.url).searchParams.get("ticket"), "one-use-proof");
      forwarded++;
      return new Response("handled");
    },
  });
  const upgrade = (origin?: string) =>
    app.request("https://api.example/live/alice?ticket=one-use-proof", {
      headers: { Upgrade: "websocket", ...(origin ? { Origin: origin } : {}) },
    });
  assert.equal((await upgrade("https://hostile.example")).status, 403);
  assert.equal(forwarded, 0);
  assert.equal((await upgrade("https://index.example")).status, 200);
  assert.equal((await upgrade()).status, 200); // Native clients authenticate with a ticket too.
  assert.equal(forwarded, 2);
});
