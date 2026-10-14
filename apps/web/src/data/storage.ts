/** Each API/account has its own database. Opening one never reads another account's values. */
export function diskStorage(name: string) {
  const database = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      let blocked = false;
      request.onupgradeneeded = () => request.result.createObjectStore("content");
      request.onsuccess = () => {
        if (blocked) request.result.close();
        else resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        blocked = true;
        reject(new Error("Content storage is blocked"));
      };
    });
  async function operation<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ) {
    const db = await database();
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = db.transaction("content", mode);
        const request = run(transaction.objectStore("content"));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
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
