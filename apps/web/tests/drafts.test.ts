import { test } from "node:test";
import assert from "node:assert/strict";
import { MalformedResponseError, ORPCError, ResponseError } from "@orpc/client";
import { MessageDraft } from "../src/features/messages/draft";
import { LinkDrafts } from "../src/features/links/draft";
import type { MessageFile, MessageReply, SavedLink } from "../src/lib/types";

const attachment = { id: "link", title: "Next link" } as SavedLink;
const quote = (id: string): MessageReply => ({
  id,
  senderId: "bob",
  excerpt: "Quoted",
  hasAttachment: false,
  files: [],
});
/** An oRPC error as the RPC link decodes it from an error response. */
const answered = (status: number, code: string) =>
  new ORPCError(code, { cause: new ResponseError({ response: { status, headers: {} } }) });
const file = (name: string) => new File(["bytes"], name);
const uploaded = (id: string): MessageFile => ({
  id,
  name: id,
  type: "image/png",
  size: 5,
  width: 1,
  height: 1,
});
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

test("the reply target is frozen into an uncertain attempt and cleared once it completes", () => {
  const draft = new MessageDraft("conversation");
  draft.reply(quote("first"));
  draft.removeReply();
  draft.reply(quote("second"));
  draft.editBody("Answer");
  const sent = draft.prepare()!;
  assert.equal(sent.replyToMessageId, "second");
  draft.fail(sent, new Error("response lost"));
  draft.reply(quote("third"));
  draft.removeReply();
  assert.equal(draft.getSnapshot().replyTo?.id, "second");
  const retry = draft.prepare()!;
  assert.equal(retry, sent);
  draft.complete(retry);
  assert.equal(draft.getSnapshot().replyTo, undefined);
  draft.editBody("Not a reply");
  assert.equal(draft.prepare()!.replyToMessageId, undefined);
});

test("a rejected reply stays editable and an abandoned one is dropped", () => {
  const draft = new MessageDraft("conversation");
  draft.reply(quote("first"));
  draft.editBody("Answer");
  draft.fail(draft.prepare()!, answered(400, "BAD_REQUEST"));
  draft.reply(quote("second"));
  assert.equal(draft.prepare()!.replyToMessageId, "second");
  const uncertain = new MessageDraft("conversation");
  uncertain.reply(quote("first"));
  uncertain.editBody("Answer");
  uncertain.fail(uncertain.prepare()!, new Error("response lost"));
  uncertain.abandonUnconfirmed();
  assert.equal(uncertain.getSnapshot().replyTo, undefined);
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
  draft.fail(sent, answered(400, "BAD_REQUEST"));
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
  assert.deepEqual(draft.getSnapshot(), { body: "", files: [], status: "editing" });
  assert.equal(draft.prepare(), undefined);
  assert.equal(new MessageDraft("conversation").getSnapshot().body, "");
});

test("an inaccessible attachment retains uncertain identity until explicitly abandoned", () => {
  const draft = new MessageDraft("conversation");
  draft.attach(attachment);
  const missing = draft.prepare()!;
  draft.fail(missing, answered(404, "NOT_FOUND"));
  draft.editBody("Cannot silently change the attempted payload");
  assert.equal(draft.prepare(), missing);
  draft.abandonUnconfirmed();
  assert.equal(draft.getSnapshot().status, "sending");
  draft.fail(missing, answered(404, "NOT_FOUND"));
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

test("files join a send in the order they were added, once all have uploaded", () => {
  const draft = new MessageDraft("conversation");
  const [first, second] = draft.addFiles([file("a.png"), file("b.png")]);
  assert.equal(draft.prepare(), undefined);
  draft.fileUploaded(second!.localId, uploaded("b"));
  draft.fileUploaded(first!.localId, uploaded("a"));
  const sent = draft.prepare()!;
  assert.deepEqual(
    sent.files.map((f) => f.id),
    ["a", "b"],
  );
  draft.complete(sent);
  assert.deepEqual(draft.getSnapshot().files, []);
});

test("a failed upload blocks sending until it is removed", () => {
  const draft = new MessageDraft("conversation");
  const [broken] = draft.addFiles([file("a.png")]);
  draft.editBody("Look");
  draft.fileFailed(broken!.localId);
  assert.equal(draft.prepare(), undefined);
  draft.removeFile(broken!.localId);
  assert.deepEqual(draft.prepare()!.files, []);
});

test("an unconfirmed send keeps its files fixed", () => {
  const draft = new MessageDraft("conversation");
  const [added] = draft.addFiles([file("a.png")]);
  draft.fileUploaded(added!.localId, uploaded("a"));
  const sent = draft.prepare()!;
  draft.fail(sent, new Error("response lost"));
  draft.removeFile(added!.localId);
  assert.deepEqual(draft.addFiles([file("b.png")]), []);
  assert.equal(draft.prepare(), sent);
});

test("a message carries at most ten files", () => {
  const draft = new MessageDraft("conversation");
  assert.equal(draft.addFiles(Array.from({ length: 12 }, (_, i) => file(`${i}.png`))).length, 10);
  assert.equal(draft.addFiles([file("more.png")]).length, 0);
});

test("an upload that finishes after its file left the draft changes nothing", () => {
  const draft = new MessageDraft("conversation");
  const [removed, kept] = draft.addFiles([file("a.png"), file("b.png")]);
  draft.removeFile(removed!.localId);
  const snapshot = draft.getSnapshot();
  draft.fileUploaded(removed!.localId, uploaded("a"));
  draft.fileFailed(removed!.localId);
  assert.equal(draft.getSnapshot(), snapshot);
  draft.discard();
  const discarded = draft.getSnapshot();
  draft.fileUploaded(kept!.localId, uploaded("b"));
  draft.fileFailed(kept!.localId);
  assert.equal(draft.getSnapshot(), discarded);
  assert.deepEqual(draft.addFiles([file("c.png")]), []);
});

test("a rejected send keeps its files for a new attempt", () => {
  const draft = new MessageDraft("conversation");
  const [added] = draft.addFiles([file("a.png")]);
  draft.fileUploaded(added!.localId, uploaded("a"));
  const rejected = draft.prepare()!;
  draft.fail(rejected, answered(400, "BAD_REQUEST"));
  const next = draft.prepare()!;
  assert.notEqual(next.clientId, rejected.clientId);
  assert.deepEqual(next.files, rejected.files);
});

test("only answers that rule out a write release the send identity", () => {
  const outcome = (error: unknown) => {
    const draft = new MessageDraft("conversation");
    draft.editBody("Hello");
    draft.fail(draft.prepare()!, error);
    return draft.getSnapshot().status;
  };
  for (const [status, code] of [
    [400, "BAD_REQUEST"],
    [413, "PAYLOAD_TOO_LARGE"],
    [422, "UNPROCESSABLE_CONTENT"],
  ] as const) {
    assert.equal(outcome(answered(status, code)), "rejected", code);
    // An unreadable answer could have followed a committed send.
    assert.equal(
      outcome(new MalformedResponseError({ response: { status, headers: {} } })),
      "uncertain",
      `${status} without an oRPC error`,
    );
  }
  for (const [status, code] of [
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [409, "CONFLICT"],
    [500, "INTERNAL_SERVER_ERROR"],
    [502, "BAD_GATEWAY"],
  ] as const)
    assert.equal(outcome(answered(status, code)), "uncertain", code);
  assert.equal(
    outcome(new MalformedResponseError({ response: { status: 426, headers: {} } })),
    "uncertain",
  );
  // Without a response, the API may have committed the message.
  assert.equal(outcome(new ORPCError("BAD_REQUEST")), "uncertain");
  assert.equal(outcome(new TypeError("Failed to fetch")), "uncertain");
});
