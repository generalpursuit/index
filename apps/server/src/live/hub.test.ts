import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { URL } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

test(
  "real Workers sockets use one-use account tickets, edge keepalives and revocation",
  { timeout: 20_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "index-hub-"));
    const port = 35000 + Math.floor(Math.random() * 10000);
    const base = `http://127.0.0.1:${port}`;
    const entry = join(directory, "entry.ts");
    await writeFile(
      entry,
      `export { AccountHub } from ${JSON.stringify(new URL("./hub.ts", import.meta.url).pathname)};
import { DurableObject } from "cloudflare:workers";
import { OutboxSchedule } from ${JSON.stringify(new URL("./schedule.ts", import.meta.url).pathname)};
import { createApp } from ${JSON.stringify(new URL("../app.ts", import.meta.url).pathname)};
export class ClockProbe extends DurableObject {
  schedule = new OutboxSchedule(this.ctx.storage);
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path.endsWith("begin")) await this.schedule.begin("write");
    if (path.endsWith("finish")) await this.schedule.finish("write");
    return Response.json({ alarm: await this.ctx.storage.getAlarm(), runs: await this.ctx.storage.get("runs") ?? 0 });
  }
  async alarm() { await this.schedule.run(async () => { await this.ctx.storage.put("runs", (await this.ctx.storage.get("runs") ?? 0) + 1); }); }
}
export default { fetch(request, env) {
  const url = new URL(request.url); const account = url.searchParams.get("account") ?? "alice";
  if (url.pathname.startsWith("/clock/")) return env.CLOCK.getByName("clock").fetch(request);
  if (url.pathname.startsWith("/live/")) return createApp({
    origins: ["https://index.example"],
    auth: async () => { throw new Error("Upgrade must not resolve auth"); },
    createContext: async () => { throw new Error("Upgrade must not create API context"); },
    readMedia: async () => null,
    connect: (account, request) => env.HUB.getByName(account).fetch(request),
  }).fetch(request, env);
  return env.HUB.getByName(account).fetch(request);
}};`,
    );
    execFileSync(
      process.execPath,
      [
        "build",
        entry,
        "--target=browser",
        "--external=cloudflare:workers",
        `--outfile=${join(directory, "worker.js")}`,
      ],
      { stdio: "pipe" },
    );
    await writeFile(
      join(directory, "config.capnp"),
      `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
 services = [(name="main", worker=(
  compatibilityDate="2026-09-01",
  modules=[(name="main", esModule=embed "worker.js")],
  durableObjectNamespaces=[(className="AccountHub", uniqueKey="index-hub-test", enableSql=true), (className="ClockProbe", uniqueKey="index-clock-test", enableSql=true)],
  durableObjectStorage=(inMemory=void),
  bindings=[(name="HUB", durableObjectNamespace="AccountHub"), (name="CLOCK", durableObjectNamespace="ClockProbe")]
 ))],
 sockets=[(name="http", address="127.0.0.1:${port}", http=(), service="main")]
);`,
    );
    const require = createRequire(
      await realpath(
        new URL("../../../../packages/infra/node_modules/alchemy/package.json", import.meta.url),
      ),
    );
    const binary = createRequire(
      require.resolve("@alchemy.run/cloudflare-runtime/package.json"),
    ).resolve("workerd/bin/workerd");
    const child = spawn(binary, ["serve", join(directory, "config.capnp")], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errors = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      errors += chunk;
    });
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    const sockets: WebSocket[] = [];
    try {
      const call = async (path: string, body: unknown = {}, account = "alice") =>
        fetch(`${base}${path}?account=${account}`, {
          method: "POST",
          body: JSON.stringify(body),
          headers: { Connection: "close" },
        });
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          await call("/presence");
          ready = true;
          break;
        } catch {
          await sleep(30);
        }
      }
      if (!ready) {
        child.kill();
        throw new Error(errors);
      }
      const ticket = async () =>
        (
          (await (
            await call("/ticket", { sessionId: "session-a", expiresAt: Date.now() + 60_000 })
          ).json()) as { ticket: string }
        ).ticket;
      const open = (value: string, account = "alice") => {
        const socket = new WebSocket(
          `${base.replace("http:", "ws:")}/live/${account}?ticket=${value}`,
        );
        sockets.push(socket);
        return socket;
      };
      const next = (socket: WebSocket) =>
        new Promise<string>((resolve, reject) => {
          socket.addEventListener("message", (event) => resolve(String(event.data)), {
            once: true,
          });
          socket.addEventListener("error", () => reject(new Error("Upgrade rejected")), {
            once: true,
          });
        });
      const proof = await ticket();
      const alice = open(proof);
      assert.equal(await next(alice), '{"type":"change"}');
      const ping = next(alice);
      alice.send("ping");
      assert.equal(await ping, "pong");
      const hint = next(alice);
      await call("/notify");
      assert.equal(await hint, '{"type":"change"}');
      await assert.rejects(next(open(proof)));
      const another = await ticket();
      await assert.rejects(next(open(another, "bob")));
      const conversationId = crypto.randomUUID();
      alice.send(JSON.stringify({ type: "presence", conversationId }));
      // Round trip through the same socket orders the presence frame before inspecting it.
      const pong = next(alice);
      alice.send("ping");
      await pong;
      const presence = (await (
        await call("/presence", { sessionId: "session-a", conversationId })
      ).json()) as { active: boolean };
      assert.equal(presence.active, true);
      const closed = new Promise<number>((resolve) =>
        alice.addEventListener("close", (event) => resolve(event.code), { once: true }),
      );
      await call("/notify", { sessionChanged: true });
      assert.equal(await closed, 4001);
      await assert.rejects(next(open(another))); // Revocation also removes unconsumed tickets.
      if (process.platform === "darwin") {
        // Exercise the actual macOS socket bridge too; Rust unit tests use OS stubs.
        const source = join(directory, "native.m");
        const executable = join(directory, "native-live");
        await writeFile(
          source,
          `#include <stdint.h>
#include <stdlib.h>
#include <string.h>
void index_show_main(void) {}
extern void index_notifications_socket_open(const char *, uint64_t);
extern char *index_notifications_socket_wait(uint64_t);
extern void index_notifications_socket_send(uint64_t, const char *);
extern void index_notifications_socket_close(uint64_t);
int main(int argc, char **argv) {
  if (argc != 2) return 1;
  index_notifications_socket_open(argv[1], 1);
  char *change = index_notifications_socket_wait(1);
  if (!change || strcmp(change, "{\\"type\\":\\"change\\"}")) return 2;
  free(change);
  index_notifications_socket_send(1, "ping");
  char *pong = index_notifications_socket_wait(1);
  int code = !pong || strcmp(pong, "pong"); free(pong);
  index_notifications_socket_close(1);
  return code ? 3 : 0;
}`,
        );
        execFileSync(
          "xcrun",
          [
            "clang",
            "-fobjc-arc",
            "-fblocks",
            new URL("../../../web/src-tauri/native/notifications.m", import.meta.url).pathname,
            source,
            "-framework",
            "Foundation",
            "-framework",
            "AppKit",
            "-framework",
            "UserNotifications",
            "-framework",
            "Security",
            "-o",
            executable,
          ],
          { stdio: "pipe" },
        );
        const proof = await ticket();
        execFileSync(executable, [`${base.replace("http:", "ws:")}/live/alice?ticket=${proof}`], {
          timeout: 10_000,
          stdio: "pipe",
        });
      }
      const begun = (await (await call("/clock/begin")).json()) as { alarm: number };
      assert.ok(begun.alarm > Date.now());
      await call("/clock/finish");
      let status = { alarm: 1 as number | null, runs: 0 };
      for (let attempt = 0; attempt < 100; attempt++) {
        status = (await (await call("/clock/status")).json()) as typeof status;
        if (status.runs === 1 && status.alarm === null) break;
        await sleep(20);
      }
      assert.deepEqual(status, { alarm: null, runs: 1 });
    } finally {
      for (const socket of sockets) socket.close();
      child.kill();
      await exited;
      if (errors) console.error(errors);
      await rm(directory, { recursive: true, force: true });
    }
  },
);
