import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { releaseDeployment } from "./deployment";

describe("release deployment configuration", () => {
  it("keeps staging and production origins separate", () => {
    const env = { WORKERS_SUBDOMAIN: "example", CI: "true" };
    assert.equal(
      releaseDeployment("staging", env)?.webURL,
      "https://index-staging-web.example.workers.dev",
    );
    assert.equal(
      releaseDeployment("production", env)?.apiURL,
      "https://index-production-api.example.workers.dev",
    );
  });
  it("fails closed for unknown CI stages or missing account configuration", () => {
    assert.throws(() => releaseDeployment("main", { CI: "true" }));
    assert.throws(() => releaseDeployment("production", {}));
    assert.throws(() => releaseDeployment("staging", { WORKERS_SUBDOMAIN: "https://wrong" }));
    assert.equal(releaseDeployment("dev_jona", {}), undefined);
  });
  it("uses custom domains consistently when configured", () => {
    const config = releaseDeployment("production", {
      WORKERS_SUBDOMAIN: "example",
      WEB_DOMAIN: "app.example.com",
      API_DOMAIN: "api.example.com",
    });
    assert.equal(config?.webURL, "https://app.example.com");
    assert.equal(config?.apiURL, "https://api.example.com");
    assert.deepEqual(config?.webRedirects, []);
    assert.throws(() =>
      releaseDeployment("production", {
        WORKERS_SUBDOMAIN: "example",
        WEB_DOMAIN: "https://app.example.com",
      }),
    );
  });
  it("redirects extra hostnames only to a configured web domain", () => {
    const env = { WORKERS_SUBDOMAIN: "example", WEB_DOMAIN: "app.example.com" };
    assert.deepEqual(
      releaseDeployment("production", {
        ...env,
        WEB_REDIRECT_DOMAINS: "a.example.com, b.example.com",
      })?.webRedirects,
      ["a.example.com", "b.example.com"],
    );
    assert.throws(() =>
      releaseDeployment("production", { ...env, WEB_REDIRECT_DOMAINS: "https://a.example.com" }),
    );
    assert.throws(() =>
      releaseDeployment("production", {
        WORKERS_SUBDOMAIN: "example",
        WEB_REDIRECT_DOMAINS: "a.example.com",
      }),
    );
  });
});
