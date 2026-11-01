import type { Permission } from "@index/auth";
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
    /** A client acting for `userId` as an app it connected with these permissions. */
    agent: (userId: string, permissions: Permission[]) =>
      createRouterClient(appRouter, {
        context: {
          ...fixture.context(null),
          caller: { kind: "agent", userId, permissions, client: { id: "agent", name: "Agent" } },
        },
      }),
    get db() {
      return fixture.db;
    },
    get postgres() {
      return fixture.client;
    },
  };
}
