import { createAuth } from "@index/auth";
import { createTestDatabase } from "@index/api/testing/database";
import assert from "node:assert/strict";
import { it } from "node:test";

it("auth availability and registration reject old usernames with friendly errors", async () => {
  const fixture = await createTestDatabase();
  try {
    await fixture.reset();
    const auth = createAuth(
      {
        BETTER_AUTH_URL: "https://api.example.test",
        BETTER_AUTH_SECRET: "isolated-namespace-test-secret-32-characters",
        CORS_ORIGIN: "https://web.example.test",
      },
      fixture.db,
    );
    await fixture.client.query(`UPDATE "user" SET username='alice_new' WHERE id='alice'`);
    const post = (path: string, body: unknown) =>
      auth.handler(
        new Request("https://api.example.test/api/auth" + path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    const available = await post("/is-username-available", { username: " ALICE " });
    assert.equal(available.status, 200);
    assert.deepEqual(await available.json(), { available: false });
    const signup = await post("/sign-up/email", {
      username: "ALICE",
      name: "New person",
      email: "new@example.test",
      password: "isolated-password-123",
    });
    assert.equal(signup.status, 400);
    const failure = (await signup.json()) as { code: string };
    assert.equal(failure.code, "USERNAME_IS_ALREADY_TAKEN");
    await fixture.client.query(`DELETE FROM "user" WHERE id='alice'`);
    assert.deepEqual(
      await (await post("/is-username-available", { username: "alice_new" })).json(),
      { available: false },
    );
  } finally {
    await fixture.close();
  }
});
