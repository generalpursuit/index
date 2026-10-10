export interface NativeSessionSnapshot {
  token: string | null;
  revision: number;
}
export interface NativeSessionStore {
  read(): Promise<NativeSessionSnapshot>;
  revision(): Promise<number>;
  write(token: string | null, expectedRevision: number): Promise<number>;
  touch?(expectedRevision: number): Promise<number>;
}
export type NativeSessionFetch = typeof fetch & {
  acceptSession(revision: number): void;
  acceptedRevision(): number | undefined;
};
const changed = () => new DOMException("Session changed", "AbortError");

/** Native CAS orders both windows; local generation also guards overlapping login attempts. */
export function createNativeSessionFetch(
  serverURL: string,
  store: NativeSessionStore,
  network: typeof fetch = fetch,
  expired: () => void = () => {},
  sessionChecked: (revision: number) => void = () => {},
  staleWindow: () => void = () => {},
  localSignOut: () => void = () => {},
): NativeSessionFetch {
  const server = new URL(serverURL);
  let generation = 0;
  let acceptedRevision: number | undefined;
  let rejectedRevision: number | undefined;
  let storage: Promise<unknown> = Promise.resolve();
  function persist(value: string | null, revision: number) {
    const operation = storage.then(() => store.write(value, revision));
    storage = operation.catch(() => {});
    return operation.catch((error: unknown) => {
      if (String(error).includes("Session changed")) throw changed();
      throw error;
    });
  }
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (
      url.origin !== server.origin ||
      !url.pathname.startsWith(server.pathname.replace(/\/$/, "") + "/")
    )
      throw new Error("Desktop credentials can only be used with the configured API.");
    const login = /\/api\/auth\/sign-(in\/(email|username)|up\/email)$/.test(url.pathname);
    const checkingSession =
      url.pathname.endsWith("/api/auth/get-session") && request.method === "GET";
    let version = login ? ++generation : generation;
    await storage;
    let { token, revision } = await store.read();
    // A hidden window may miss the peer event entirely. Never adopt a new account
    // just because its credential is now in Keychain: that would submit the old
    // account's draft (or Sign out) using the new account's bearer.
    if (!login && !checkingSession && revision !== acceptedRevision) {
      if (rejectedRevision !== revision) {
        rejectedRevision = revision;
        staleWindow();
      }
      throw changed();
    }
    const current = async () => {
      if (version !== generation || revision !== (await store.revision())) throw changed();
    };
    if (login) {
      revision = await persist(null, revision);
      token = null;
      acceptedRevision = revision;
      await current();
    }
    const hadToken = token !== null;
    const headers = new Headers(request.headers);
    if (token) headers.set("Authorization", "Bearer " + token);
    else headers.delete("Authorization");
    const logout = url.pathname.endsWith("/api/auth/sign-out");
    if (logout) {
      // Capture the old bearer in headers, then erase locally before any network
      // wait. Revocation may hang/fail; neither window may retain usable content.
      version = ++generation;
      revision = await persist(null, revision);
      acceptedRevision = revision;
      localSignOut();
    }
    try {
      const response = await network(request, { headers, credentials: "omit", redirect: "error" });
      // Headers alone are insufficient: another window may change account while a
      // private body is streaming. Finish the body before validating the revision.
      await response.clone().arrayBuffer();
      await current();
      if (response.status === 401) {
        revision = await persist(null, revision);
        version = ++generation;
        acceptedRevision = revision;
        if (hadToken) expired();
      } else if (response.ok && !logout) {
        const next = response.headers.get("set-auth-token");
        const emptySession =
          url.pathname.endsWith("/api/auth/get-session") &&
          (await response.clone().json()) === null;
        await current();
        if (emptySession && hadToken) {
          revision = await persist(null, revision);
          version = ++generation;
          acceptedRevision = revision;
          expired();
        } else if (next) {
          const prior = revision;
          revision = await persist(next, revision);
          if (login || acceptedRevision === prior) acceptedRevision = revision;
          await current();
        }
        if (
          store.touch &&
          request.method !== "GET" &&
          /\/api\/auth\/security\/(verify-email|correct-email|confirm-email-change|change-password|reset-password)$/.test(
            url.pathname,
          )
        ) {
          revision = await store.touch(revision);
          acceptedRevision = revision;
          await current();
        }
      }
      await current();
      if (response.ok && checkingSession) sessionChecked(revision);
      return response;
    } catch (error) {
      // A delayed failure from account A must not show an error in account B.
      await current();
      throw error;
    }
  };
  return Object.assign(transport, {
    acceptSession(revision: number) {
      acceptedRevision = revision;
      rejectedRevision = undefined;
    },
    acceptedRevision: () => acceptedRevision,
  });
}
