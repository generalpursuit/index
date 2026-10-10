import { it } from "node:test";
import assert from "node:assert/strict";
import { notificationPath } from "../src/features/notifications/navigation";
it("only the active notification account can hand canonical paths to the access resolver", () => {
  assert.equal(
    notificationPath({ path: "/messages/abc_123", recipientId: "alice" }, "alice"),
    "/messages/abc_123",
  );
  assert.equal(notificationPath({ path: "/l/abc", recipientId: "bob" }, "alice"), null);
  assert.equal(notificationPath(null, "alice"), null);
  for (const path of [
    "//evil.test",
    "https://evil.test/l/abc",
    "/messages/../settings",
    "/l/abc?token=secret",
    "/u/a%2Fb",
  ])
    assert.equal(notificationPath({ path, recipientId: "alice" }, "alice"), null);
});
