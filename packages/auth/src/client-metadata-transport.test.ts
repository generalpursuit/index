import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clientMetadataTransport } from "./client-metadata-transport";

describe("client metadata transport", () => {
  const sent: Request[] = [];
  const transport = clientMetadataTransport(async (input) => {
    sent.push(input as Request);
    return Response.redirect("https://elsewhere.example/client.json", 302);
  });

  it("sends HTTPS reads that never follow redirects", async () => {
    const controller = new AbortController();
    const response = await transport("https://agent.example/client.json", {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
    assert.equal(response.status, 302);
    const request = sent.at(-1)!;
    assert.equal(request.method, "GET");
    assert.equal(request.redirect, "manual");
    assert.equal(request.headers.get("accept"), "application/json");
    controller.abort();
    assert.equal(request.signal.aborted, true);
    await transport(new Request("https://agent.example/client.json", { method: "HEAD" }));
    assert.equal(sent.at(-1)!.method, "HEAD");
  });

  it("refuses anything but HTTPS GET and HEAD", async () => {
    const before = sent.length;
    for (const url of ["http://agent.example/client.json", "ftp://agent.example/client.json"])
      await assert.rejects(async () => transport(url), TypeError);
    await assert.rejects(
      async () => transport("https://agent.example/client.json", { method: "POST", body: "{}" }),
      TypeError,
    );
    assert.equal(sent.length, before);
  });
});
