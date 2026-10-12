import { test } from "node:test";
import assert from "node:assert/strict";
import { MessageDraft } from "../src/features/messages/draft";
import { LinkDrafts } from "../src/features/links/draft";
import type { SavedLink } from "../src/lib/types";

const attachment = { id: "link", title: "Next link" } as SavedLink;
test("a lost successful send retries the exact payload and identity after edits or attachment navigation", () => {
  const draft = new MessageDraft("conversation");
  draft.editBody("Original");
  const sent = draft.prepare()!;
  const serverMessages = new Map([[sent.clientId, sent]]);
  draft.fail(sent, new Error("response lost"));
  draft.editBody("Changed");
  draft.attach(attachment);
  draft.removeAttachment();
  const retry = draft.prepare()!;
  assert.equal(retry, sent);
  assert.equal(retry.body, "Original");
  serverMessages.set(retry.clientId, retry);
  draft.complete(retry);
  assert.equal(serverMessages.size, 1);
  assert.equal(draft.getSnapshot().attachment, attachment);
  assert.equal(draft.getSnapshot().body, "");
});

test("attachment arriving during send survives completion for the next message", () => {
  const draft = new MessageDraft("conversation");
  draft.editBody("Sending");
  const sent = draft.prepare()!;
  assert.equal(draft.prepare(), undefined);
  draft.attach(attachment);
  assert.equal(sent.linkId, undefined);
  draft.complete(sent);
  const next = draft.prepare()!;
  assert.equal(next.linkId, attachment.id);
  assert.notEqual(next.clientId, sent.clientId);
  draft.complete(sent);
  draft.fail(sent, new Error("late old error"));
  assert.equal(draft.getSnapshot().status, "sending");
  draft.complete(next);
  assert.equal(draft.getSnapshot().attachment, undefined);
});

test("definite validation rejection releases editing and starts a new attempt", () => {
  const draft = new MessageDraft("conversation");
  draft.editBody("Rejected");
  const sent = draft.prepare()!;
  draft.fail(sent, { status: 400 });
  assert.equal(draft.getSnapshot().status, "rejected");
  draft.editBody("Corrected");
  const next = draft.prepare()!;
  assert.equal(next.body, "Corrected");
  assert.notEqual(next.clientId, sent.clientId);
});

test("discarded account drafts ignore all late operations and cannot be resent", () => {
  const draft = new MessageDraft("conversation");
  draft.editBody("Private");
  const sent = draft.prepare()!;
  draft.discard();
  draft.complete(sent);
  draft.fail(sent, new Error("late"));
  draft.attach(attachment);
  draft.editBody("Late edit");
  assert.deepEqual(draft.getSnapshot(), { body: "", status: "editing" });
  assert.equal(draft.prepare(), undefined);
  assert.equal(new MessageDraft("conversation").getSnapshot().body, "");
});

test("an inaccessible attachment retains uncertain identity until explicitly abandoned", () => {
  const draft = new MessageDraft("conversation");
  draft.attach(attachment);
  const missing = draft.prepare()!;
  draft.fail(missing, { status: 404 });
  draft.editBody("Cannot silently change the attempted payload");
  assert.equal(draft.prepare(), missing);
  draft.abandonUnconfirmed();
  assert.equal(draft.getSnapshot().status, "sending");
  draft.fail(missing, { status: 404 });
  draft.attach({ ...attachment, id: "next" });
  draft.abandonUnconfirmed();
  assert.equal(draft.getSnapshot().attachment?.id, "next");
  draft.editBody("New message");
  const next = draft.prepare()!;
  assert.notEqual(next.clientId, missing.clientId);
  draft.complete(missing);
  assert.equal(draft.getSnapshot().status, "sending");
});

test("link save removes only the submitted draft; failures and later edits retain input", () => {
  const drafts = new LinkDrafts();
  const initial = { url: "https://example.test", title: "Old", description: "", groupId: null };
  const submitted = { ...initial, title: "Saved" };
  drafts.edit("link", submitted);
  assert.equal(drafts.read("link", initial), submitted);
  drafts.complete("link", submitted);
  assert.deepEqual(drafts.read("link", submitted), submitted);
  const newer = { ...submitted, title: "More edits" };
  drafts.edit("link", newer);
  drafts.complete("link", submitted);
  assert.equal(drafts.read("link", submitted), newer);
  drafts.clear();
  drafts.complete("link", newer);
  assert.equal(drafts.read("link", initial), initial);
});
