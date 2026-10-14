/** Each API/account has its own database. Opening one never reads another account's values. */
export function diskStorage(name: string) {
  let opened: Promise<IDBDatabase> | undefined;
  const database = () =>
    (opened ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("content");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  async function operation<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ) {
    const db = await database();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction("content", mode);
      const request = run(transaction.objectStore("content"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
  }
  return {
    getItem: (key: string) =>
      operation("readonly", (store) => store.get(key)) as Promise<string | null>,
    setItem: async (key: string, value: string) => {
      await operation("readwrite", (store) => store.put(value, key));
    },
    removeItem: async (key: string) => {
      await operation("readwrite", (store) => store.delete(key));
    },
  };
}
export type ContentStorage = ReturnType<typeof diskStorage>;
