import { version } from "../../../../package.json";

/** Identify this release so the API can ask unsupported clients to update. */
export function identifyClient(network: typeof fetch, platform: "web" | "desktop"): typeof fetch {
  const identity = `${platform}/${version}`;
  return (input, init) => {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    headers.set("X-Index-Client", identity);
    return network(input, { ...init, headers });
  };
}
