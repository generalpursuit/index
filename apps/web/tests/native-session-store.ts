import type { NativeSessionStore } from "../src/lib/desktop/session-fetch";
/** Fixture of the native serialized CAS contract; never uses a system credential store. */
export function nativeSessionStore(storage: {
  read(): Promise<string | null>;
  write(token: string | null): Promise<void>;
}): NativeSessionStore {
  let revision = 0;
  let queue: Promise<unknown> = Promise.resolve();
  function serialized<T>(task: () => Promise<T>) {
    const operation = queue.then(task);
    queue = operation.catch(() => {});
    return operation;
  }
  function check(expected: number) {
    if (expected !== revision) throw new Error("Session changed");
  }
  return {
    read: () => serialized(async () => ({ token: await storage.read(), revision })),
    revision: () => serialized(async () => revision),
    write: (token, expected) =>
      serialized(async () => {
        check(expected);
        if (token !== null && token === (await storage.read())) return revision;
        await storage.write(token);
        return ++revision;
      }),
    touch: (expected) =>
      serialized(async () => {
        check(expected);
        return ++revision;
      }),
  };
}
