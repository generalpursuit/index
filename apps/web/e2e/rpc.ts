import type { Request } from "@playwright/test";
/** One call in a batch; its URL is relative to the batch request's. */
type BatchItem = {
  id: string;
  kind: "request";
  json: { url: string; body?: unknown; method?: string; headers?: Record<string, string> };
};
const batchItems = (request: Request) =>
  request.headers()["orpc-batch"] ? (request.postDataJSON() as BatchItem[]) : undefined;
const itemURL = (request: Request, item: BatchItem) => new URL(item.json.url, request.url()).href;

/** Counts logical reads even when they share one physical request. */
export function rpcPaths(request: Request) {
  const items = batchItems(request);
  if (items) return items.map((item) => new URL(itemURL(request, item)).pathname);
  return [new URL(request.url()).pathname];
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
    const items = batchItems(request);
    if (!items) {
      if (match.test(request.url())) await handler(route);
      else await route.fallback();
      return;
    }
    if (!items.some((item) => match.test(itemURL(request, item)))) {
      await route.fallback();
      return;
    }
    const headers = await request.allHeaders();
    delete headers["orpc-batch"];
    const responses = await Promise.all(
      items.map(async (item) => {
        const url = itemURL(request, item);
        const fetchItem = () =>
          route.fetch({
            url,
            method: item.json.method ?? request.method(),
            headers: { ...headers, ...item.json.headers },
            postData: JSON.stringify(item.json.body),
          });
        let answer: { status: number; body: unknown } | undefined;
        const virtual = new Proxy(route, {
          get: (target, property) => {
            if (property === "request")
              return () =>
                new Proxy(request, {
                  get: (source, key) => {
                    if (key === "url") return () => url;
                    if (key === "postDataJSON") return () => item.json.body;
                    const value = Reflect.get(source, key);
                    return typeof value === "function" ? value.bind(source) : value;
                  },
                });
            if (property === "fetch") return fetchItem;
            if (property === "continue")
              return async () => {
                const response = await fetchItem();
                answer = { status: response.status(), body: await response.json() };
              };
            if (property === "abort")
              return async () => {
                answer = {
                  status: 503,
                  body: {
                    json: {
                      defined: false,
                      code: "INTERNAL_SERVER_ERROR",
                      message: "Fixture request failed",
                    },
                  },
                };
              };
            if (property === "fulfill")
              return async (options: NonNullable<Parameters<Route["fulfill"]>[0]>) => {
                answer = {
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
        if (match.test(url)) await handler(virtual);
        else await virtual.continue();
        if (!answer) throw new Error("RPC fixture did not complete its read");
        return { id: item.id, kind: "response", json: answer };
      }),
    );
    // A JSON array of responses is valid in either batch mode.
    await route.fulfill({ status: 207, contentType: "application/json", json: responses });
  });
}
