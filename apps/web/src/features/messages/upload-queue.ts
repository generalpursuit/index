/**
 * Runs uploads `limit` at a time, in the order they were added. Each task handles its own
 * failure. Aborting a task skips it while it waits. A running task keeps its slot until it
 * settles: decoding an image can't be cancelled, and an aborted request settles almost at once.
 */
export function createUploadQueue(limit: number) {
  const waiting: { run: (signal: AbortSignal) => Promise<unknown>; controller: AbortController }[] =
    [];
  const running = new Set<AbortController>();
  function next() {
    while (running.size < limit && waiting.length) {
      const { run, controller } = waiting.shift()!;
      if (controller.signal.aborted) continue;
      running.add(controller);
      const free = () => {
        running.delete(controller);
        next();
      };
      // Started through a promise, so a task that throws at once still frees its slot.
      void new Promise<unknown>((resolve) => resolve(run(controller.signal))).then(free, free);
    }
  }
  return {
    /** Adds an upload; its controller aborts it. */
    enqueue(run: (signal: AbortSignal) => Promise<unknown>) {
      const controller = new AbortController();
      waiting.push({ run, controller });
      next();
      return controller;
    },
    /** Aborts every upload, waiting or running. */
    clear() {
      // Waiting uploads never start; running ones keep their slots until they settle.
      for (const { controller } of waiting.splice(0)) controller.abort();
      for (const controller of running) controller.abort();
    },
  };
}
