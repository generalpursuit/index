import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { AppRouterClient } from "@index/api/contracts";
import { createTestDatabase } from "@index/api/testing/database";
import { createAuth } from "@index/auth";
import type { SecurityEmail } from "@index/auth/delivery";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { BatchLinkPlugin } from "@orpc/client/plugins";
import { createApp } from "./app";
import { minimumClientVersions } from "./client-version";
import { mediaCacheControl, readPhoto } from "./media";

const origin = "https://api.example.com";
const web = "https://web.example.com";
const password = "secure-test-password-123";
const config = {
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: "test-only-secret-with-at-least-32-characters",
  CORS_ORIGIN: web,
};

describe("mounted server application", () => {
  let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: ReturnType<typeof createApp>;
  let tasks: Promise<unknown>[];
  let mail: SecurityEmail[];
  let contexts: number;
  let authRequests: number;
  let deliveryGate: Promise<void> | undefined;
  before(async () => {
    fixture = await createTestDatabase();
  });
  beforeEach(async () => {
    await Promise.all(tasks ?? []);
    await fixture.reset();
    tasks = [];
    mail = [];
    contexts = 0;
    authRequests = 0;
    deliveryGate = undefined;
    const auth = (backgroundTask: (task: Promise<unknown>) => void) =>
      createAuth(config, fixture.db, [], {
        backgroundTask,
        sendEmail: async (message) => {
          if (message.purpose === "reset") await deliveryGate;
          mail.push(message);
        },
      });
    app = createApp({
      origins: [web, "tauri://localhost"],
      auth: async (backgroundTask) => {
        authRequests++;
        return auth(backgroundTask);
      },
      createContext: async (request, backgroundTask) => {
        contexts++;
        return {
          ...fixture.context(null),
          session: await auth(backgroundTask).api.getSession({ headers: request.headers }),
        };
      },
      readMedia: (key) =>
        readPhoto(
          {
            get: (async () =>
              key === "avatars/photo.png"
                ? {
                    body: new Blob(["photo bytes"]).stream(),
                    httpEtag: '"photo-etag"',
                    writeHttpMetadata(headers: Headers) {
                      headers.set("content-type", "image/png");
                    },
                  }
                : null) as R2Bucket["get"],
          },
          key,
        ),
    });
  });
  after(async () => {
    await Promise.all(tasks ?? []);
    await fixture?.close();
  });
  const execution = {
    waitUntil(task: Promise<unknown>) {
      tasks.push(task);
    },
    passThroughOnException() {},
    props: {},
  };
  const fetchApp = async (request: Request) => app.fetch(request, {}, execution);
  const request = (path: string, init?: RequestInit) =>
    fetchApp(new Request(`${origin}${path}`, init));
  const post = (path: string, body: unknown, token?: string, browserOrigin = web) =>
    request(`/api/auth${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: browserOrigin,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  async function signup() {
    const response = await post("/sign-up/email", {
      name: "Reader",
      username: "reader",
      email: "reader@example.test",
      password,
    });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get("access-control-allow-origin"), web);
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
    assert.equal(response.headers.get("access-control-expose-headers"), "set-auth-token");
    const token = response.headers.get("set-auth-token");
    assert.ok(token);
    return token;
  }

  it("keeps health, unrelated paths, preflights and media outside database/session context", async () => {
    assert.equal(await (await request("/")).text(), "OK");
    for (const path of ["/missing", "/api/v10/health", "/rpc-similar/healthCheck"])
      assert.equal((await request(path)).status, 404);
    const preflight = await request("/api/v1/links", {
      method: "OPTIONS",
      headers: {
        Origin: web,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), web);
    assert.match(preflight.headers.get("access-control-allow-headers")!, /Authorization/);
    const photo = await request("/media/avatars/photo.png");
    assert.equal(photo.status, 200);
    assert.equal(await photo.text(), "photo bytes");
    assert.equal(photo.headers.get("content-type"), "image/png");
    assert.equal(photo.headers.get("etag"), '"photo-etag"');
    assert.equal(photo.headers.get("cache-control"), mediaCacheControl);
    assert.equal((await request("/media/missing")).status, 404);
    assert.equal(contexts, 0);
    assert.equal(authRequests, 0);
  });

  it("mounts real auth, fresh cookie/bearer sessions, REST and both RPC aliases", async () => {
    assert.equal((await request("/api/v1/me/profile")).status, 401);
    const token = await signup();
    assert.equal(contexts, 1, "Auth must not also construct API context");
    for (const headers of [
      new Headers({ Authorization: `Bearer ${token}` }),
      new Headers({ Cookie: `__Secure-better-auth.session_token=${token}` }),
    ]) {
      assert.equal((await request("/api/v1/me/profile", { headers })).status, 403);
      assert.equal((await request("/api/v1/me/pulse", { headers })).status, 403);
    }
    const verified = await post("/security/verify-email", { code: mail.at(-1)!.code }, token);
    assert.equal(verified.status, 200);
    for (const headers of [
      new Headers({ Authorization: `Bearer ${token}` }),
      new Headers({ Cookie: `__Secure-better-auth.session_token=${token}` }),
    ]) {
      const response = await request("/api/v1/me/profile", { headers });
      assert.equal(response.status, 200);
      assert.equal(((await response.json()) as { username: string }).username, "reader");
    }
    for (const prefix of ["/rpc/v1", "/rpc"]) {
      const rpc: AppRouterClient = createORPCClient(
        new RPCLink({
          url: `${origin}${prefix}`,
          headers: { Authorization: `Bearer ${token}` },
          fetch: fetchApp,
        }),
      );
      assert.equal(await rpc.healthCheck(), "OK");
      assert.equal((await rpc.profiles.me()).username, "reader");
    }
    assert.equal(await (await request("/api/v1/health")).json(), "OK");
    const specification = await request("/api/v1/openapi.json");
    assert.equal(specification.status, 200);
    const { paths } = (await specification.json()) as { paths: Record<string, unknown> };
    assert.ok(paths["/me/profile"]);
    assert.equal(paths["/private-data"], undefined);
    assert.equal((await request("/api/v1/private-data")).status, 404);
  });

  it("asks unsupported clients to update before auth or API context runs", async () => {
    const preflight = await request("/rpc/v1/links/list", {
      method: "OPTIONS",
      headers: {
        Origin: web,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-index-client",
      },
    });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get("access-control-allow-headers")!, /X-Index-Client/);
    for (const path of ["/rpc/v1/links/list", "/api/v1/links", "/api/auth/get-session"]) {
      const outdated = await request(path, {
        headers: { Origin: web, "X-Index-Client": "web/0.0.1" },
      });
      assert.equal(outdated.status, 426);
      assert.equal(outdated.headers.get("access-control-allow-origin"), web);
      assert.deepEqual(await outdated.json(), {
        code: "CLIENT_UPDATE_REQUIRED",
        message: "Update Index to continue.",
      });
    }
    assert.equal(contexts, 0);
    assert.equal(authRequests, 0);
    const current = await request("/", {
      headers: { "X-Index-Client": `web/${minimumClientVersions.web}` },
    });
    assert.equal(await current.text(), "OK");
  });

  for (const mode of ["streaming", "buffered"] as const) {
    it(`shares one authenticated context and preserves per-call errors in a ${mode} batch`, async () => {
      const token = await signup();
      await post("/security/verify-email", { code: mail.at(-1)!.code }, token);
      const requests: Request[] = [];
      const rpc: AppRouterClient = createORPCClient(
        new RPCLink({
          url: `${origin}/rpc/v1`,
          headers: {
            Authorization: `Bearer ${token}`,
            "X-Index-Client": `web/${minimumClientVersions.web}`,
          },
          plugins: [
            new BatchLinkPlugin({ mode, groups: [{ condition: () => true, context: {} }] }),
          ],
          fetch: async (request) => {
            requests.push(request.clone());
            return fetchApp(request);
          },
        }),
      );
      const results = await Promise.allSettled([
        rpc.healthCheck(),
        rpc.profiles.me(),
        rpc.links.get({ id: crypto.randomUUID() }),
      ]);
      assert.equal(requests.length, 1);
      assert.equal(requests[0]!.headers.get("x-orpc-batch"), mode);
      assert.equal(contexts, 1);
      assert.deepEqual(results[0], { status: "fulfilled", value: "OK" });
      assert.equal(results[1]!.status, "fulfilled");
      assert.equal(results[2]!.status, "rejected");
      if (results[2]!.status === "rejected") assert.equal(results[2]!.reason.code, "NOT_FOUND");

      const outdated = await fetchApp(
        new Request(requests[0]!, { headers: { "X-Index-Client": "web/0.0.1" } }),
      );
      assert.equal(outdated.status, 426);
      assert.equal(contexts, 1);
      const preflight = await request("/rpc/v1", {
        method: "OPTIONS",
        headers: {
          Origin: web,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type,x-index-client,x-orpc-batch",
        },
      });
      assert.equal(preflight.status, 204);
      assert.match(preflight.headers.get("access-control-allow-headers")!, /X-ORPC-Batch/);
      assert.equal(contexts, 1);
    });
  }

  it("allows configured desktop origins and withholds CORS permission from untrusted origins", async () => {
    const desktop = await request("/", { headers: { Origin: "tauri://localhost" } });
    assert.equal(desktop.headers.get("access-control-allow-origin"), "tauri://localhost");
    const untrusted = await request("/", { headers: { Origin: "https://evil.example" } });
    assert.equal(untrusted.headers.get("access-control-allow-origin"), null);
    const rejected = await post(
      "/sign-in/email",
      { email: "reader@example.test", password },
      undefined,
      "https://evil.example",
    );
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers.get("access-control-allow-origin"), null);
  });

  it("propagates waitUntil through mounted auth without awaiting recovery delivery", async () => {
    await signup();
    await Promise.all(tasks);
    tasks = [];
    const pending = Promise.withResolvers<void>();
    deliveryGate = pending.promise;
    try {
      const response = await post("/security/request-reset", { email: "reader@example.test" });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { success: true, retryAfter: 60 });
      assert.equal(mail.filter((message) => message.purpose === "reset").length, 0);
      assert.ok(tasks.length > 0);
      assert.equal(contexts, 0);
    } finally {
      pending.resolve();
      await Promise.all(tasks);
    }
    assert.equal(mail.filter((message) => message.purpose === "reset").length, 1);
  });
});
