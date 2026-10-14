import { test } from "node:test";
import assert from "node:assert/strict";
import { acknowledgeConversation } from "../src/features/messages/edits";
test("a delayed read acknowledgement preserves unread messages newer than its watermark", () => {
  const conversation = {
    id: "chat",
    participants: [],
    lastMessage: { id: "newer" },
    unreadCount: 1,
  };
  assert.deepEqual(acknowledgeConversation(conversation, "chat", "older"), conversation);
  assert.deepEqual(acknowledgeConversation({ items: [conversation] }, "chat", "newer"), {
    items: [{ ...conversation, unreadCount: 0 }],
  });
});
