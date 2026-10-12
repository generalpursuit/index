import assert from "node:assert/strict";
import { test } from "bun:test";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const fixtureShape = z.object({
  people: z.object({ Alice: z.string(), Bob: z.string(), Iris: z.string() }),
  week: z.string(),
  older: z.string(),
  links: z.array(z.object({ id: z.string(), title: z.string() })),
  privateLink: z.object({ id: z.string() }),
  reading: z.object({ id: z.string() }),
  notes: z.object({ id: z.string() }),
  conversationId: z.string(),
  conversationShortId: z.string(),
});
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

for (const samples of [false, true]) {
  test(`disposable fixture supports native bearer clients${samples ? " with extra samples" : " and reset"}`, async () => {
    const port = await freePort();
    const origin = `http://localhost:${port}`;
    const child = Bun.spawn(
      [process.execPath, fileURLToPath(new URL("./server.ts", import.meta.url))],
      {
        env: {
          ...process.env,
          E2E_API_PORT: String(port),
          E2E_WEB_PORT: "5493",
          E2E_MORE_SAMPLES: samples ? "1" : "",
          E2E_LIVE_PAGES: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdout = new Response(child.stdout).text();
    const stderr = new Response(child.stderr).text();
    try {
      let ready = false;
      for (let attempt = 0; attempt < 300 && child.exitCode === null; attempt++) {
        try {
          ready = (await fetch(origin + "/health")).ok;
        } catch {
          /* Wait for migrations and fixture registration. */
        }
        if (ready) break;
        await Bun.sleep(100);
      }
      assert.ok(ready, "Fixture did not become ready within 30 seconds");
      const fixture = fixtureShape.parse(await (await fetch(origin + "/_test/fixture")).json());
      assert.equal(fixture.links.length, 4);
      assert.equal(fixture.links[0]?.title, "Are.na");
      assert.ok(fixture.week > fixture.older);
      const signedIn = await fetch(origin + "/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "alice@test.example", password: "test-password-123" }),
      });
      assert.equal(signedIn.status, 200);
      const token = signedIn.headers.get("set-auth-token");
      assert.ok(token?.includes("."));
      const headers = { Authorization: `Bearer ${token}`, Origin: "tauri://localhost" };
      const profileResponse = await fetch(origin + "/api/v1/me/profile", { headers });
      assert.equal(profileResponse.headers.get("access-control-allow-origin"), "tauri://localhost");
      const profile = z
        .object({ id: z.string(), username: z.string() })
        .parse(await profileResponse.json());
      assert.equal(profile.id, fixture.people.Alice);
      assert.equal(profile.username, "alice");
      const groupResponse = await fetch(`${origin}/api/v1/groups?ownerId=${fixture.people.Alice}`, {
        headers,
      });
      assert.equal(groupResponse.status, 200);
      assert.match(await groupResponse.text(), new RegExp(fixture.reading.id));
      if (samples) {
        const extra = await fetch(origin + "/api/v1/profiles/by-username/sofia_marques", {
          headers,
        });
        assert.equal(extra.status, 200);
        assert.equal(
          z.object({ name: z.string() }).parse(await extra.json()).name,
          "Sofia Marques",
        );
      } else {
        const notify = await fetch(origin + "/_test/notify", { method: "POST" });
        assert.equal(notify.status, 200);
        z.object({ ids: z.array(z.string()) }).parse(await notify.json());
        const next = fixtureShape.parse(
          await (await fetch(origin + "/_test/reset", { method: "POST" })).json(),
        );
        assert.notEqual(next.people.Alice, fixture.people.Alice);
        assert.equal((await fetch(origin + "/api/v1/me/profile", { headers })).status, 401);
        const current = fixtureShape.parse(await (await fetch(origin + "/_test/fixture")).json());
        assert.equal(current.people.Alice, next.people.Alice);
      }
    } finally {
      child.kill();
      await child.exited;
      const errors = await stderr;
      const output = await stdout;
      if (!output.includes("Isolated browser-test API ready")) console.error(errors);
    }
  }, 60_000);
}
