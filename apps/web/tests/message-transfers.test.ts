import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import { MessageDraft } from "../src/features/messages/draft";
import { receiveDroppedText } from "../src/features/messages/conversation-drop";
import { droppedFiles, droppedText, pastedFiles } from "../src/features/messages/transfers";
import type { SavedLink } from "../src/lib/types";

const image = (name: string) => new File(["bytes"], name, { type: "image/png" });
/** Clipboard or drag data as the browser reports it, with only what these readers use. */
function transfer({
  files = [],
  text = "",
  uriList = "",
  folders = [],
}: {
  files?: File[];
  text?: string;
  uriList?: string;
  folders?: string[];
}) {
  const entries = [
    ...files.map((file) => ({ kind: "file", getAsFile: () => file, webkitGetAsEntry: () => null })),
    ...folders.map((name) => ({
      kind: "file",
      getAsFile: () => new File([], name),
      webkitGetAsEntry: () => ({ isDirectory: true }),
    })),
    { kind: "string", getAsFile: () => null, webkitGetAsEntry: () => null },
  ];
  return {
    files: [...files, ...folders.map((name) => new File([], name))],
    items: entries,
    getData: (type: string) =>
      type === "text/plain" ? text : type === "text/uri-list" ? uriList : "",
  } as unknown as DataTransfer;
}

test("a paste attaches its files unless they are only a picture of the pasted text", () => {
  const screenshot = image("Screenshot.png");
  assert.deepEqual(pastedFiles(transfer({ files: [screenshot] })), [screenshot]);

  // Finder puts the copied files' names beside them, with or without their folders.
  const photos = [image("beach.png"), image("dinner 2.png")];
  for (const text of ["beach.png\ndinner 2.png", "/Users/me/beach.png\r\nC:\\Photos\\dinner 2.png"])
    assert.deepEqual(pastedFiles(transfer({ files: photos, text })), photos);

  // "Copy Image" puts the image alone, or beside its address.
  const copied = image("image.png");
  assert.deepEqual(pastedFiles(transfer({ files: [copied] })), [copied]);
  assert.deepEqual(
    pastedFiles(transfer({ files: [copied], text: "https://example.com/cat.png" })),
    [copied],
  );

  // Numbers, Excel and Word put a picture of copied cells or text beside the text itself.
  assert.deepEqual(pastedFiles(transfer({ files: [copied], text: "Rent\t1200\nFood\t300" })), []);

  const report = new File(["%PDF"], "report.pdf", { type: "application/pdf" });
  assert.deepEqual(pastedFiles(transfer({ files: [report], text: "Quarterly report" })), [report]);
});

test("a drop brings its files without folders, else its first address or its text", () => {
  const photo = image("photo.png");
  assert.deepEqual(droppedFiles(transfer({ files: [photo], folders: ["Holiday"] })), [photo]);
  assert.deepEqual(droppedFiles(transfer({ folders: ["Holiday"] })), []);

  assert.equal(
    droppedText(
      transfer({
        uriList: "# a comment\r\nhttps://example.com/first\r\nhttps://example.com/second",
        text: "Example",
      }),
    ),
    "https://example.com/first",
  );
  assert.equal(droppedText(transfer({ text: "  some words \n" })), "some words");
});

const origin = "https://index.example";
const post = { id: "link-1", title: "A post" } as SavedLink;
const routes: Record<string, { kind: string; linkId?: string }> = {
  "/l/short-1": { kind: "link", linkId: post.id },
  "/u/bob": { kind: "profile" },
};
const resolved: string[] = [];
const api = {
  routes: {
    resolve: {
      queryOptions: ({ input }: { input: { path: string } }) => ({
        queryKey: ["resolve", input.path],
        queryFn: async () => {
          resolved.push(input.path);
          const route = routes[input.path];
          if (!route) throw Object.assign(new Error("Not found"), { status: 404 });
          return route;
        },
      }),
    },
  },
  links: {
    get: {
      queryOptions: ({ input }: { input: { id: string } }) => ({
        queryKey: ["link", input.id],
        queryFn: async () => (input.id === post.id ? post : undefined),
      }),
    },
  },
} as unknown as Parameters<typeof receiveDroppedText>[2];
const cache = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const original = Object.getOwnPropertyDescriptor(globalThis, "location");
const pageAt = (pageOrigin: string) =>
  Object.defineProperty(globalThis, "location", {
    value: { origin: pageOrigin },
    configurable: true,
  });
before(() => pageAt(origin));
after(() => {
  if (original) Object.defineProperty(globalThis, "location", original);
  else Reflect.deleteProperty(globalThis, "location");
});

test("a dropped Index post attaches, by its own address or as opened over a page", async () => {
  for (const address of [`${origin}/l/short-1`, `${origin}/?post=short-1`]) {
    const draft = new MessageDraft("conversation");
    draft.editBody("Look");
    await receiveDroppedText(draft, address, api, cache());
    assert.equal(draft.getSnapshot().attachment, post);
    assert.equal(draft.getSnapshot().body, "Look");
  }
});

test("other dropped addresses and text join the message's text, within its limit", async () => {
  const draft = new MessageDraft("conversation");
  draft.editBody("Look at  ");
  await receiveDroppedText(draft, "https://elsewhere.example/article", api, cache());
  assert.equal(draft.getSnapshot().body, "Look at https://elsewhere.example/article");

  // Index pages other than posts, and posts that don't resolve, stay addresses.
  for (const address of [`${origin}/u/bob`, `${origin}/l/missing`]) {
    const other = new MessageDraft("conversation");
    await receiveDroppedText(other, address, api, cache());
    assert.equal(other.getSnapshot().body, address);
    assert.equal(other.getSnapshot().attachment, undefined);
  }

  const long = new MessageDraft("conversation");
  long.editBody("a".repeat(9_995));
  await receiveDroppedText(long, "dropped words", api, cache());
  assert.equal(long.getSnapshot().body, "a".repeat(9_995) + " drop");
});

test("addresses without an origin of their own never match the page", async () => {
  pageAt("null");
  try {
    resolved.length = 0;
    const draft = new MessageDraft("conversation");
    await receiveDroppedText(draft, "data:text/plain,hello", api, cache());
    assert.equal(draft.getSnapshot().body, "data:text/plain,hello");
    assert.deepEqual(resolved, []);
  } finally {
    pageAt(origin);
  }
});

test("during a send, dropped text is refused and a dropped post waits for the next message", async () => {
  const draft = new MessageDraft("conversation");
  draft.editBody("Sending");
  assert.ok(draft.prepare());
  await receiveDroppedText(draft, "more words", api, cache());
  assert.equal(draft.getSnapshot().body, "Sending");
  await receiveDroppedText(draft, `${origin}/l/short-1`, api, cache());
  assert.equal(draft.getSnapshot().queuedAttachment, post);
  assert.equal(draft.getSnapshot().attachment, undefined);
});

test("a failed lookup is not retried, so the drop lands at once", async () => {
  resolved.length = 0;
  // As in the app, whose queries retry other failures.
  const retrying = new QueryClient({ defaultOptions: { queries: { retry: 2, retryDelay: 0 } } });
  const draft = new MessageDraft("conversation");
  await receiveDroppedText(draft, `${origin}/l/missing`, api, retrying);
  assert.deepEqual(resolved, ["/l/missing"]);
  assert.equal(draft.getSnapshot().body, `${origin}/l/missing`);
});
