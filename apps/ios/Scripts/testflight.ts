// Uploads an archive and hands the build to public TestFlight testers through the App Store Connect API:
// "What to Test", the public group, then Beta App Review. To finish a build that is already uploaded,
// rerun with --version and --build; the later steps are safe to repeat.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const bundleID = "com.generalpursuit.index";
const { values } = parseArgs({
  options: {
    archive: { type: "string" },
    version: { type: "string" },
    build: { type: "string" },
    notes: { type: "string" },
    group: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});
if (values.help) {
  console.log(`Usage: bun apps/ios/Scripts/testflight.ts (--archive <path> | --version <x.y.z> --build <n>) --notes <text> [--group <name>] [--dry-run]

--archive uploads the .xcarchive first and reads its version and build. Without it, the
uploaded build is found by --version and --build. --group names the external group when the
app has more than one with a public link. --dry-run reads App Store Connect and changes nothing.

APP_STORE_CONNECT_KEY_ID and APP_STORE_CONNECT_ISSUER_ID select the API key (Admin role, for cloud signing);
APP_STORE_CONNECT_KEY_PATH defaults to ~/.appstoreconnect/private_keys/AuthKey_<key id>.p8.`);
  process.exit(0);
}

const keyID = process.env.APP_STORE_CONNECT_KEY_ID;
const issuer = process.env.APP_STORE_CONNECT_ISSUER_ID;
if (!keyID || !issuer)
  throw new Error("Set APP_STORE_CONNECT_KEY_ID and APP_STORE_CONNECT_ISSUER_ID.");
const keyPath =
  process.env.APP_STORE_CONNECT_KEY_PATH ??
  join(homedir(), ".appstoreconnect/private_keys", `AuthKey_${keyID}.p8`);
const dryRun = values["dry-run"];
if (!values.notes && !dryRun) throw new Error("--notes is required: it becomes What to Test.");

const plist = (path: string, key: string) => {
  const result = spawnSync("plutil", ["-extract", key, "raw", "-o", "-", path], {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`${path} has no ${key}.`);
  return result.stdout.trim();
};
const archiveInfo = values.archive && join(values.archive, "Info.plist");
const version = archiveInfo
  ? plist(archiveInfo, "ApplicationProperties.CFBundleShortVersionString")
  : values.version;
const buildNumber = archiveInfo
  ? plist(archiveInfo, "ApplicationProperties.CFBundleVersion")
  : values.build;
if (!version || !buildNumber) throw new Error("Pass --archive, or --version and --build.");

const pem = readFileSync(keyPath, "utf8");
const key = await crypto.subtle.importKey(
  "pkcs8",
  Buffer.from(pem.replace(/-----[^-]+-----|\s/g, ""), "base64"),
  { name: "ECDSA", namedCurve: "P-256" },
  false,
  ["sign"],
);
const base64url = (data: string | ArrayBuffer) =>
  (typeof data === "string" ? Buffer.from(data) : Buffer.from(new Uint8Array(data))).toString(
    "base64url",
  );
// Apple accepts ES256 tokens for at most 20 minutes, so each request signs a fresh one.
async function token() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyID, typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({ iss: issuer, iat: now, exp: now + 600, aud: "appstoreconnect-v1" }),
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  return `${header}.${claims}.${base64url(signature)}`;
}

type Resource = { id: string; type: string; attributes: Record<string, unknown> };
async function api<T = { data: Resource[] }>(
  path: string,
  query: Record<string, string> = {},
  method = "GET",
  body?: unknown,
): Promise<T> {
  const url = new URL(path, "https://api.appstoreconnect.apple.com");
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  const headers = { authorization: `Bearer ${await token()}`, "content-type": "application/json" };
  const response = await fetch(
    url,
    body === undefined ? { method, headers } : { method, headers, body: JSON.stringify(body) },
  );
  if (!response.ok)
    throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

const [app] = (await api("/v1/apps", { "filter[bundleId]": bundleID })).data;
if (!app) throw new Error(`The API key cannot see ${bundleID}.`);
const external = (await api(`/v1/apps/${app.id}/betaGroups`, { limit: "200" })).data.filter(
  (group) => !group.attributes.isInternalGroup,
);
const candidates = values.group
  ? external.filter((group) => group.attributes.name === values.group)
  : external.filter((group) => group.attributes.publicLinkEnabled);
if (candidates.length !== 1) {
  const names = external.map((group) => `"${group.attributes.name}"`).join(", ") || "none";
  throw new Error(`Choose one external group with --group. External groups: ${names}.`);
}
const group = candidates[0]!;
console.log(`${app.attributes.name} ${version} (${buildNumber}) → ${group.attributes.name}`);
if (dryRun) {
  const builds = (
    await api("/v1/builds", {
      "filter[app]": app.id,
      "filter[preReleaseVersion.version]": version,
      sort: "-uploadedDate",
      limit: "5",
    })
  ).data;
  for (const build of builds)
    console.log(
      `  uploaded build ${build.attributes.version}: ${build.attributes.processingState}`,
    );
  process.exit(0);
}

if (values.archive) {
  // The key signs and uploads, so no Xcode account sign-in is needed.
  const scratch = mkdtempSync(join(tmpdir(), "index-testflight-"));
  try {
    const options = join(scratch, "ExportOptions.plist");
    writeFileSync(
      options,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>signingStyle</key><string>automatic</string>
  <key>teamID</key><string>${plist(archiveInfo!, "ApplicationProperties.Team")}</string>
</dict></plist>`,
    );
    const upload = spawnSync(
      "xcodebuild",
      [
        "-exportArchive",
        "-archivePath",
        values.archive,
        "-exportOptionsPlist",
        options,
        "-exportPath",
        join(scratch, "export"),
        "-allowProvisioningUpdates",
        "-authenticationKeyPath",
        keyPath,
        "-authenticationKeyID",
        keyID,
        "-authenticationKeyIssuerID",
        issuer,
      ],
      { stdio: "inherit" },
    );
    if (upload.status !== 0) throw new Error("The upload failed.");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// Processing usually takes minutes; the build is not listed until Apple has received it.
async function processed(appID: string, version: string, buildNumber: string): Promise<Resource> {
  for (const deadline = Date.now() + 60 * 60_000; ;) {
    const [build] = (
      await api("/v1/builds", {
        "filter[app]": appID,
        "filter[version]": buildNumber,
        "filter[preReleaseVersion.version]": version,
      })
    ).data;
    const state = build?.attributes.processingState;
    if (build && state === "VALID") return build;
    if (state === "FAILED" || state === "INVALID")
      throw new Error(`Apple rejected the build: ${state}.`);
    if (Date.now() > deadline)
      throw new Error("The build did not finish processing within an hour.");
    console.log(`Waiting for processing (${state ?? "not listed yet"})…`);
    await Bun.sleep(30_000);
  }
}
const build = await processed(app.id, version, buildNumber);

const whatsNew = values.notes!;
const localizations = (await api(`/v1/builds/${build.id}/betaBuildLocalizations`)).data;
for (const localization of localizations)
  await api(`/v1/betaBuildLocalizations/${localization.id}`, {}, "PATCH", {
    data: { type: "betaBuildLocalizations", id: localization.id, attributes: { whatsNew } },
  });
if (!localizations.length)
  await api("/v1/betaBuildLocalizations", {}, "POST", {
    data: {
      type: "betaBuildLocalizations",
      attributes: { locale: "en-US", whatsNew },
      relationships: { build: { data: { type: "builds", id: build.id } } },
    },
  });

await api(`/v1/betaGroups/${group.id}/relationships/builds`, {}, "POST", {
  data: [{ type: "builds", id: build.id }],
});

const detail = await api<{ data: Resource }>(`/v1/builds/${build.id}/buildBetaDetail`);
const externalState = detail.data.attributes.externalBuildState;
if (externalState === "READY_FOR_BETA_SUBMISSION")
  await api("/v1/betaAppReviewSubmissions", {}, "POST", {
    data: {
      type: "betaAppReviewSubmissions",
      relationships: { build: { data: { type: "builds", id: build.id } } },
    },
  });
else if (externalState === "MISSING_EXPORT_COMPLIANCE")
  throw new Error("The build lacks export compliance; check ITSAppUsesNonExemptEncryption.");
const final = await api<{ data: Resource }>(`/v1/builds/${build.id}/buildBetaDetail`);
console.log(`External testing: ${final.data.attributes.externalBuildState}`);
