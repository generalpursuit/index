import { Procedure, type AnyProcedure } from "@orpc/server";
import assert from "node:assert/strict";
import { it } from "node:test";

import { requireVerifiedSession } from "../procedures";
import { appRouter } from ".";

function procedures(router: object, path: string[] = []): [string, AnyProcedure][] {
  if (router instanceof Procedure) return [[path.join("."), router]];
  return Object.entries(router).flatMap(([key, child]) => procedures(child, [...path, key]));
}

// oRPC applies a router's middleware to procedures that already carry it from the same
// implementer, so building a router from `implementer.use(...)` runs that middleware twice.
it("runs each middleware once per procedure", () => {
  for (const [path, procedure] of procedures(appRouter)) {
    const counts = new Map<unknown, number>();
    for (const { middleware } of procedure["~orpc"].orderedMiddlewares)
      counts.set(middleware, (counts.get(middleware) ?? 0) + 1);
    for (const [middleware, count] of counts)
      // Feature routers that serve anonymous reads also check the session themselves.
      assert.ok(count <= (middleware === requireVerifiedSession ? 2 : 1), path);
  }
});
