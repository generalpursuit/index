import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { fileURLToPath, URL } from "node:url";

it("bundles the shared contract for browsers without server, auth, or database code", async () => {
  const directory = await mkdtemp(join(tmpdir(), "index-contract-"));
  try {
    const metafile = join(directory, "meta.json");
    execFileSync("bun", [
      "build",
      fileURLToPath(new URL("./contracts.ts", import.meta.url)),
      "--target=browser",
      `--outfile=${join(directory, "contract.js")}`,
      `--metafile=${metafile}`,
    ]);
    const metadata: { inputs: Record<string, unknown> } = JSON.parse(
      await readFile(metafile, "utf8"),
    );
    for (const file of Object.keys(metadata.inputs)) {
      assert.doesNotMatch(
        file,
        /drizzle-orm|neondatabase|better-auth|@orpc\/server|@electric-sql|\/schema\/|repository\.ts|service\.ts/,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
