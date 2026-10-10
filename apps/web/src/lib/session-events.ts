import { accountGeneration, assertCurrentAccount } from "./account-boundary";

/** Check after reading the body too: a delayed old response must not expire a new identity. */
export function createSessionEventFetch(
  network: typeof fetch,
  notify: (event: "index:session-expired" | "index:verification-required") => void,
): typeof fetch {
  return async (input, init) => {
    const generation = accountGeneration();
    const response = await network(input, init);
    assertCurrentAccount(generation);
    if (response.status === 403) {
      const body = await response
        .clone()
        .json()
        .catch(() => null);
      assertCurrentAccount(generation);
      const error = body?.json ?? body; // oRPC envelopes errors; REST/Better Auth do not.
      if (error?.code === "EMAIL_NOT_VERIFIED" || error?.data?.code === "EMAIL_NOT_VERIFIED") {
        notify("index:verification-required");
      }
    } else if (response.status === 401) {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (
        url.pathname.startsWith("/api/v1/") ||
        url.pathname.startsWith("/rpc/") ||
        url.pathname.startsWith("/api/auth/security/")
      ) {
        notify("index:session-expired");
      }
    }
    return response;
  };
}
