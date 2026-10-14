import { test } from "node:test";
import assert from "node:assert/strict";
import { diskStorage } from "../src/data/storage";

test("disk storage closes completed and aborted connections and recovers after a blocked open", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  let closed = 0,
    opens = 0,
    blocked = false,
    aborted = false;
  let lateOpen: (() => void) | undefined;
  const database = () => ({
    close: () => {
      closed++;
    },
    transaction: () => {
      const request = { result: "content" };
      const transaction = {
        error: new Error("connection lost"),
        oncomplete: undefined as (() => void) | undefined,
        onabort: undefined as (() => void) | undefined,
        objectStore: () => ({ get: () => request, put: () => request, delete: () => request }),
      };
      queueMicrotask(() => (aborted ? transaction.onabort?.() : transaction.oncomplete?.()));
      return transaction;
    },
  });
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open: () => {
        opens++;
        const request = {
          result: database(),
          onblocked: undefined as (() => void) | undefined,
          onsuccess: undefined as (() => void) | undefined,
        };
        queueMicrotask(() => {
          if (blocked) {
            lateOpen = () => request.onsuccess?.();
            request.onblocked?.();
          } else request.onsuccess?.();
        });
        return request;
      },
    },
  });
  try {
    const store = diskStorage("account");
    assert.equal(await store.getItem("cache"), "content");
    await store.setItem("cache", "content");
    await store.removeItem("cache");
    assert.equal(closed, 3);
    aborted = true;
    await assert.rejects(store.getItem("cache"), /connection lost/);
    assert.equal(closed, 4);
    aborted = false;
    blocked = true;
    await assert.rejects(store.getItem("cache"), /blocked/);
    lateOpen!();
    assert.equal(closed, 5);
    blocked = false;
    assert.equal(await store.getItem("cache"), "content");
    assert.equal(opens, 6);
    assert.equal(closed, 6);
  } finally {
    if (original) Object.defineProperty(globalThis, "indexedDB", original);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  }
});
