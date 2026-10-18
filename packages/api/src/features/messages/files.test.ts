import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { messageFiles } from "@index/db/schema/app";
import { setupApiTests } from "../../testing/api";
import { files } from "../../testing/database";
import { fileName, inlineImageTypes, maxFileBytes, servedType } from "./files";
import { sweepStagedFiles } from "./service";

describe("file names and types", () => {
  it("drops folders written either way", () => {
    assert.equal(fileName("../../a.pdf"), "a.pdf");
    assert.equal(fileName("C:\\a\\b.pdf"), "b.pdf");
  });

  it("removes text-direction marks that disguise an extension", () => {
    assert.equal(fileName("photo\u202Egpj.exe"), "photogpj.exe");
    assert.equal(fileName("photo\u2066gpj.exe"), "photogpj.exe");
  });

  it("removes C0 and C1 controls and line breaks", () => {
    assert.equal(fileName("a\u0000b\u001Fc\u007Fd"), "abcd");
    assert.equal(fileName("a\u0080b\u0085c\u009Fd"), "abcd");
    assert.equal(fileName("a\u2028b\u2029c"), "abc");
  });

  it("never returns an empty name", () => {
    for (const name of [undefined, "", "  \t ", "dir/", ".", "..", "\u202E"])
      assert.equal(fileName(name), "File");
  });

  it("keeps the extension when it shortens a long name", () => {
    const shortened = fileName(`${"a".repeat(226)}.pdf`);
    assert.equal([...shortened].length, 200);
    assert.ok(shortened.endsWith(".pdf"));
  });

  it("counts characters by code point", () => {
    assert.equal(fileName("😀.png"), "😀.png");
    const shortened = fileName(`${"😀".repeat(226)}.png`);
    assert.equal([...shortened].length, 200);
    assert.ok(shortened.isWellFormed());
    assert.ok(shortened.endsWith(".png"));
  });

  it("serves only inline image types as themselves", () => {
    const bytes = (...values: number[]) => new Uint8Array(values);
    assert.equal(servedType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)), "image/gif");
    assert.equal(servedType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), "image/png");
    assert.equal(servedType(new TextEncoder().encode("<svg")), "application/octet-stream");
  });

  it("serves exactly the inline image types besides opaque bytes", () => {
    const samples = [
      [0xff, 0xd8, 0xff, 0xe0],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
      [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
      [0x25, 0x50, 0x44, 0x46],
      [0x3c, 0x73, 0x76, 0x67],
      [],
    ];
    const served = new Set(samples.map((bytes) => servedType(Uint8Array.from(bytes))));
    served.delete("application/octet-stream");
    assert.deepEqual(served, inlineImageTypes);
  });
});

const pngBytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4];
const png = (name = "photo.png") =>
  new File([Uint8Array.from(pngBytes)], name, { type: "image/png" });
const pdf = () => new File(["%PDF-1.4 brunch"], "Sunday menu.pdf", { type: "application/pdf" });

describe("message files", () => {
  const api = setupApiTests();
  async function chat() {
    const alice = api.client("alice");
    await alice.follows.follow({ userId: "bob" });
    return alice.messages.createConversation({ recipientIds: ["bob"] });
  }
  const send = (conversationId: string, fileIds: string[], body = "") => ({
    conversationId,
    clientId: crypto.randomUUID(),
    body,
    fileIds,
  });

  it("sends uploaded files in order, typed by their bytes, to members only", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    const c = await chat();
    // A name WebKit can't read in a multipart response: CJK and macOS's narrow space before PM.
    const photo = await alice.messages.upload({
      conversationId: c.id,
      file: png("東京 at 9.41\u202fPM.png"),
      width: 1200,
      height: 800,
    });
    assert.equal(photo.name, "東京 at 9.41\u202fPM.png");
    const menu = await alice.messages.upload({
      conversationId: c.id,
      file: pdf(),
      width: 10,
      height: 10,
    });
    assert.deepEqual([photo.type, photo.width, photo.height], ["image/png", 1200, 800]);
    assert.deepEqual(
      [menu.name, menu.type, menu.width, menu.height],
      ["Sunday menu.pdf", "application/octet-stream", null, null],
    );
    const sent = await alice.messages.send(send(c.id, [menu.id, photo.id]));
    assert.deepEqual(
      sent.files.map((file) => file.id),
      [menu.id, photo.id],
    );
    const [received] = (await bob.messages.list({ conversationId: c.id })).items;
    assert.deepEqual(received!.files, sent.files);
    const inbox = await bob.messages.conversations({});
    assert.deepEqual(inbox.items[0]!.lastMessage!.files, sent.files);
    // zod types files minimally in the Workers types; what arrives is a real File.
    const read = (await bob.messages.file({
      conversationId: c.id,
      fileId: photo.id,
    })) as unknown as File;
    assert.equal(read.type, "image/png");
    // The bytes come back under the file's ID; members see the name from the message.
    assert.equal(read.name, photo.id);
    assert.deepEqual([...new Uint8Array(await read.arrayBuffer())], pngBytes);
    await assert.rejects(
      api.client("carol").messages.file({ conversationId: c.id, fileId: photo.id }),
      { code: "NOT_FOUND" },
    );
    // Membership elsewhere does not open a file through another conversation's address.
    await alice.follows.follow({ userId: "carol" });
    const elsewhere = await alice.messages.createConversation({ recipientIds: ["carol"] });
    await assert.rejects(alice.messages.file({ conversationId: elsewhere.id, fileId: photo.id }), {
      code: "NOT_FOUND",
    });
  });

  it("answers a retry with the same files and rejects any other set", async () => {
    const alice = api.client("alice");
    const c = await chat();
    const photo = await alice.messages.upload({ conversationId: c.id, file: png() });
    const other = await alice.messages.upload({ conversationId: c.id, file: png("other.png") });
    const first = send(c.id, [photo.id], "Look");
    const sent = await alice.messages.send(first);
    assert.equal((await alice.messages.send(first)).id, sent.id);
    assert.equal(
      (await alice.messages.send({ ...first, fileIds: [photo.id.toUpperCase()] })).id,
      sent.id,
    );
    for (const fileIds of [[], [other.id], [photo.id, other.id]])
      await assert.rejects(alice.messages.send({ ...first, fileIds }), { code: "NOT_FOUND" });
    // A sent file belongs to its message and cannot be sent again.
    await assert.rejects(alice.messages.send(send(c.id, [photo.id])), { code: "NOT_FOUND" });
    // The files' order is part of the payload too.
    const third = await alice.messages.upload({ conversationId: c.id, file: png("third.png") });
    const pair = send(c.id, [other.id, third.id]);
    await alice.messages.send(pair);
    await assert.rejects(alice.messages.send({ ...pair, fileIds: [third.id, other.id] }), {
      code: "NOT_FOUND",
    });
  });

  it("sends only the sender's own unsent files from the same conversation", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    const c = await chat();
    await alice.follows.follow({ userId: "carol" });
    const elsewhere = await alice.messages.createConversation({ recipientIds: ["carol"] });
    const bobs = await bob.messages.upload({ conversationId: c.id, file: png() });
    const moved = await alice.messages.upload({ conversationId: elsewhere.id, file: png() });
    for (const id of [bobs.id, moved.id])
      await assert.rejects(alice.messages.send(send(c.id, [id])), { code: "NOT_FOUND" });
    // Unsent files are on their uploader's device only; nobody reads them from the server.
    await assert.rejects(bob.messages.file({ conversationId: c.id, fileId: bobs.id }), {
      code: "NOT_FOUND",
    });
    const stored = files.keys().length;
    await assert.rejects(
      api.client("dana").messages.upload({ conversationId: c.id, file: png() }),
      {
        code: "NOT_FOUND",
      },
    );
    assert.equal(files.keys().length, stored);
  });

  it("limits files to 25 MB each, ten per message and each once", async () => {
    const alice = api.client("alice");
    const c = await chat();
    const big = new File([new Uint8Array(maxFileBytes + 1)], "big.bin");
    await assert.rejects(alice.messages.upload({ conversationId: c.id, file: big }), {
      code: "BAD_REQUEST",
    });
    const ids = Array.from({ length: 11 }, () => crypto.randomUUID());
    await assert.rejects(alice.messages.send(send(c.id, ids)), { code: "BAD_REQUEST" });
    for (const twice of [ids[0]!, ids[0]!.toUpperCase()])
      await assert.rejects(alice.messages.send(send(c.id, [ids[0]!, twice])), {
        code: "BAD_REQUEST",
      });
    await assert.rejects(alice.messages.send(send(c.id, [])), { code: "BAD_REQUEST" });
    const uploaded: string[] = [];
    for (let n = 0; n < 10; n++)
      uploaded.push((await alice.messages.upload({ conversationId: c.id, file: png() })).id);
    // Sent opposite to their upload order, so only the message's own order explains the result.
    const ten = [...uploaded].reverse();
    const sent = await alice.messages.send(send(c.id, ten));
    assert.deepEqual(
      sent.files.map((file) => file.id),
      ten,
    );
  });

  it("quotes the files of a replied message", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    const c = await chat();
    const photo = await alice.messages.upload({ conversationId: c.id, file: png() });
    const original = await alice.messages.send(send(c.id, [photo.id]));
    const reply = await bob.messages.send({
      ...send(c.id, [], "Nice"),
      replyToMessageId: original.id,
    });
    assert.deepEqual(reply.replyTo!.files, original.files);
    assert.equal(reply.replyTo!.hasAttachment, false);
  });

  it("sweeps day-old unsent files and keeps sent and recent ones", async () => {
    const alice = api.client("alice");
    const c = await chat();
    const kept = await alice.messages.upload({ conversationId: c.id, file: png() });
    const abandoned = await alice.messages.upload({ conversationId: c.id, file: png() });
    const recent = await alice.messages.upload({ conversationId: c.id, file: png() });
    await alice.messages.send(send(c.id, [kept.id]));
    // The recent file stays as uploaded, so only its age protects it.
    await api.postgres.query(
      "update message_files set created_at = now() - interval '2 days' where id in ($1, $2)",
      [kept.id, abandoned.id],
    );
    const before = await api.db.select().from(messageFiles);
    await sweepStagedFiles(api.db, files);
    const after = await api.db.select().from(messageFiles);
    assert.deepEqual(after.map((row) => row.id).sort(), [kept.id, recent.id].sort());
    const keyOf = (id: string) => before.find((row) => row.id === id)!.objectKey;
    assert.equal(files.keys().includes(keyOf(abandoned.id)), false);
    assert.equal(files.keys().includes(keyOf(kept.id)), true);
    assert.equal(files.keys().includes(keyOf(recent.id)), true);
  });
});
