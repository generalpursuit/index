import { test } from "node:test";
import assert from "node:assert/strict";
import { createUploadQueue } from "../src/features/messages/upload-queue";

/**
 * Uploads that run until the test settles them. Like an image decode, they ignore their
 * signal, so only settling ends them.
 */
function uploads() {
  const started: string[] = [];
  const settlers = new Map<string, (failed?: boolean) => void>();
  let running = 0;
  let most = 0;
  return {
    started,
    mostAtOnce: () => most,
    run: (name: string) => () => {
      started.push(name);
      most = Math.max(most, ++running);
      return new Promise<void>((resolve, reject) =>
        settlers.set(name, (failed) => {
          running--;
          if (failed) reject(new Error(name));
          else resolve();
        }),
      );
    },
    settle: (name: string, failed?: boolean) => settlers.get(name)!(failed),
  };
}
const settled = () => new Promise((resolve) => setTimeout(resolve));

test("uploads run two at a time, in the order they were added", async () => {
  const queue = createUploadQueue(2);
  const upload = uploads();
  for (const name of ["a", "b", "c"]) queue.enqueue(upload.run(name));
  assert.deepEqual(upload.started, ["a", "b"]);
  upload.settle("b");
  await settled();
  assert.deepEqual(upload.started, ["a", "b", "c"]);
  assert.equal(upload.mostAtOnce(), 2);
});

test("a failed upload frees its slot", async () => {
  const queue = createUploadQueue(2);
  const upload = uploads();
  for (const name of ["a", "b", "c"]) queue.enqueue(upload.run(name));
  upload.settle("a", true);
  await settled();
  assert.deepEqual(upload.started, ["a", "b", "c"]);
});

test("an upload that throws at once frees its slot", async () => {
  const queue = createUploadQueue(2);
  const upload = uploads();
  queue.enqueue(() => {
    throw new Error("broken");
  });
  for (const name of ["a", "b"]) queue.enqueue(upload.run(name));
  await settled();
  assert.deepEqual(upload.started, ["a", "b"]);
});

test("an aborted upload is skipped while waiting and frees its slot when it settles", async () => {
  const queue = createUploadQueue(2);
  const upload = uploads();
  const [running, , waiting] = ["a", "b", "c", "d"].map((name) => queue.enqueue(upload.run(name)));
  waiting!.abort();
  running!.abort();
  // Part of an upload can't be cancelled, so its slot stays taken until it ends.
  assert.deepEqual(upload.started, ["a", "b"]);
  upload.settle("a", true);
  await settled();
  assert.deepEqual(upload.started, ["a", "b", "d"]);
});

test("an upload aborted and then settled frees exactly one slot", async () => {
  const queue = createUploadQueue(2);
  const upload = uploads();
  const [aborted] = ["a", "b", "c"].map((name) => queue.enqueue(upload.run(name)));
  aborted!.abort();
  upload.settle("a");
  await settled();
  queue.enqueue(upload.run("d"));
  assert.deepEqual(upload.started, ["a", "b", "c"]);
  upload.settle("b");
  await settled();
  assert.deepEqual(upload.started, ["a", "b", "c", "d"]);
  assert.equal(upload.mostAtOnce(), 2);
});

test("clearing aborts every upload, and running ones keep their slots until they settle", async () => {
  const queue = createUploadQueue(2);
  const upload = uploads();
  const controllers = ["a", "b", "c"].map((name) => queue.enqueue(upload.run(name)));
  queue.clear();
  assert.deepEqual(
    controllers.map((controller) => controller.signal.aborted),
    [true, true, true],
  );
  queue.enqueue(upload.run("d"));
  assert.deepEqual(upload.started, ["a", "b"]);
  upload.settle("a", true);
  upload.settle("b", true);
  await settled();
  assert.deepEqual(upload.started, ["a", "b", "d"]);
  assert.equal(upload.mostAtOnce(), 2);
});
