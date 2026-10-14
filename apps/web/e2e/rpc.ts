import type { Request } from "@playwright/test";
/** Counts logical reads even when they share one physical request. */
export function rpcPaths(request: Request) {
  const url = new URL(request.url());
  const batch = url.searchParams.get("batch");
  const items = batch
    ? JSON.parse(batch)
    : request.headers()["x-orpc-batch"]
      ? request.postDataJSON()
      : undefined;
  if (Array.isArray(items))
    return (items as { url: string }[]).map((item) => new URL(item.url).pathname);
  return [url.pathname];
}

import type { Page, Route } from "@playwright/test";
/** Apply a fixture to a logical RPC read even when another read owns the batch URL. */
export async function routeRPC(page: Page, pattern: string, handler: (route: Route) => unknown) {
  const match = new RegExp(
    "^" +
      pattern
        .split("**")
        .map((part) =>
          part
            .split("*")
            .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("[^/]*"),
        )
        .join(".*") +
      "$",
  );
  await page.route("**/rpc/v1/**", async (route) => {
    const request = route.request();
    if (!request.headers()["x-orpc-batch"]) {
      if (match.test(request.url())) await handler(route);
      else await route.fallback();
      return;
    }
    const items = request.postDataJSON() as {
      url: string;
      body: unknown;
      method?: string;
      headers?: Record<string, string>;
    }[];
    if (!items.some((item) => match.test(item.url))) {
      await route.fallback();
      return;
    }
    const headers = await request.allHeaders();
    delete headers["x-orpc-batch"];
    const responses = await Promise.all(
      items.map(async (item, index) => {
        const fetchItem = () =>
          route.fetch({
            url: item.url,
            method: item.method ?? request.method(),
            headers: { ...headers, ...item.headers },
            postData: JSON.stringify(item.body),
          });
        let packet: { index: number; status: number; body: unknown } | undefined;
        const virtual = new Proxy(route, {
          get: (target, property) => {
            if (property === "request")
              return () =>
                new Proxy(request, {
                  get: (source, key) => {
                    if (key === "url") return () => item.url;
                    if (key === "postDataJSON") return () => item.body;
                    const value = Reflect.get(source, key);
                    return typeof value === "function" ? value.bind(source) : value;
                  },
                });
            if (property === "fetch") return fetchItem;
            if (property === "continue")
              return async () => {
                const response = await fetchItem();
                packet = { index, status: response.status(), body: await response.json() };
              };
            if (property === "abort")
              return async () => {
                packet = {
                  index,
                  status: 503,
                  body: {
                    json: { code: "INTERNAL_SERVER_ERROR", message: "Fixture request failed" },
                  },
                };
              };
            if (property === "fulfill")
              return async (options: NonNullable<Parameters<Route["fulfill"]>[0]>) => {
                packet = {
                  index,
                  status: options.status ?? options.response?.status() ?? 200,
                  body:
                    options.json ??
                    (options.body
                      ? JSON.parse(String(options.body))
                      : await options.response?.json()),
                };
              };
            const value = Reflect.get(target, property);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        if (match.test(item.url)) await handler(virtual);
        else await virtual.continue();
        if (!packet) throw new Error("RPC fixture did not complete its read");
        return packet;
      }),
    );
    await route.fulfill({ status: 207, contentType: "application/json", json: responses });
  });
}
