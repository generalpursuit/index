export interface NativeSessionStore {
  read(): Promise<string | null>;
  write(token: string | null): Promise<void>;
}

/** Scope native bearer credentials to one API and discard responses from an old session. */
export function createNativeSessionFetch(
  serverURL: string,
  store: NativeSessionStore,
  network: typeof fetch = fetch,
  expired: () => void = () => {},
): typeof fetch {
  const server = new URL(serverURL);
  let token: string | null = null;
  let loaded: Promise<void> | undefined;
  let generation = 0;
  let storage = Promise.resolve();
  const persist = (value: string | null) => {
    const operation = storage.then(() => store.write(value));
    storage = operation.catch(() => {});
    return operation;
  };
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (
      url.origin !== server.origin ||
      !url.pathname.startsWith(server.pathname.replace(/\/$/, "") + "/")
    )
      throw new Error("Desktop credentials can only be used with the configured API.");
    loaded ??= store
      .read()
      .then((stored) => {
        token = stored;
      })
      .catch((error) => {
        loaded = undefined;
        throw error;
      });
    await loaded;
    if (/\/api\/auth\/sign-(in|up)\/email$/.test(url.pathname)) {
      generation++;
      token = null;
      await persist(null);
    }
    const version = generation;
    const hadToken = token !== null;
    const headers = new Headers(request.headers);
    if (token) headers.set("Authorization", "Bearer " + token);
    else headers.delete("Authorization");
    const logout = url.pathname.endsWith("/api/auth/sign-out");
    try {
      const response = await network(request, { headers, credentials: "omit", redirect: "error" });
      if (version !== generation) throw new DOMException("Session changed", "AbortError");
      if (response.status === 401) {
        token = null;
        generation++;
        await persist(null);
        if (hadToken) expired();
      } else if (response.ok && !logout) {
        const next = response.headers.get("set-auth-token");
        // A null session is how Better Auth reports an expired bearer token.
        const emptySession =
          url.pathname.endsWith("/api/auth/get-session") &&
          (await response.clone().json()) === null;
        if (emptySession && hadToken) {
          token = null;
          generation++;
          await persist(null);
          expired();
        } else if (next) {
          await persist(next);
          token = next;
        }
      }
      return response;
    } finally {
      if (logout) {
        generation++;
        token = null;
        await persist(null);
      }
    }
  };
}
