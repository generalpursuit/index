import { user } from "@index/db/schema/auth";
import { createRouterClient } from "@orpc/server";
import { after, before, beforeEach } from "node:test";
import { appRouter } from "../routers";
import { createTestDatabase } from "./database";

export function setupApiTests() {
  let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
  before(async () => {
    fixture = await createTestDatabase();
  });
  beforeEach(async () => {
    await fixture.reset();
    await fixture.db.insert(user).values([
      { id: "carol", name: "Carol", email: "carol@example.com" },
      { id: "dana", name: "Dana", email: "dana@example.com" },
    ]);
  });
  after(async () => {
    await fixture?.close();
  });
  return {
    client: (actor: string | null) =>
      createRouterClient(appRouter, { context: fixture.context(actor) }),
    get db() {
      return fixture.db;
    },
    get postgres() {
      return fixture.client;
    },
  };
}
