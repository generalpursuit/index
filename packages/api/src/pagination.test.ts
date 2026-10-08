import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decodeCursor, encodeCursor } from "./pagination";

describe("timestamp cursors", () => {
  it("round-trips PostgreSQL timestamp precision in a URL-safe token", () => {
    const value = {
      id: "00000000-0000-4000-8000-000000000001",
      createdAt: "2026-10-08T10:00:00.123456Z",
    };
    const token = encodeCursor(value);
    assert.match(token, /^[\w-]+$/);
    const result = decodeCursor(token);
    assert.ok(result.isOk());
    assert.deepEqual(result.value, value);
  });

  it("returns a neverthrow error for malformed or structurally invalid tokens", () => {
    for (const cursor of [
      "%%%",
      btoa("not JSON"),
      btoa("null"),
      btoa("{}"),
      btoa(JSON.stringify({ id: "wrong", createdAt: "yesterday" })),
      encodeCursor({
        id: "00000000-0000-4000-8000-000000000001",
        createdAt: "0000-01-01T00:00:00.000000Z",
      }),
    ]) {
      const result = decodeCursor(cursor);
      assert.ok(result.isErr());
      assert.equal(result.error.code, "BAD_REQUEST");
    }
  });
});
