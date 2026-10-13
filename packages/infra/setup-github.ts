import { execFileSync } from "node:child_process";
import { releaseBranch, releaseStages } from "./deployment";

const repository = "repos/generalpursuit/index";
function github(method: string, path: string, body?: unknown) {
  const output = execFileSync(
    "gh",
    ["api", "--method", method, path, ...(body ? ["--input", "-"] : [])],
    { encoding: "utf8", input: body ? JSON.stringify(body) : undefined },
  );
  return output ? JSON.parse(output) : undefined;
}

// Alchemy beta.80 sends reviewer settings even when omitted. GitHub rejects
// those on this account's plan, so bootstrap only the supported branch policy.
for (const stage of releaseStages) {
  const path = `${repository}/environments/${stage}`;
  github("PUT", path, {
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
  });
  const { branch_policies: policies } = github(
    "GET",
    `${path}/deployment-branch-policies?per_page=100`,
  ) as {
    branch_policies: { id: number; name: string; type: string }[];
  };
  if (!policies.some((policy) => policy.name === releaseBranch && policy.type === "branch"))
    github("POST", `${path}/deployment-branch-policies`, { name: releaseBranch, type: "branch" });
  for (const policy of policies)
    if (policy.name !== releaseBranch || policy.type !== "branch")
      github("DELETE", `${path}/deployment-branch-policies/${policy.id}`);
  console.log(`${stage}: deployments allowed from ${releaseBranch}`);
}

execFileSync(
  "bun",
  [
    "run",
    "alchemy",
    "deploy",
    "--config",
    "github.run.ts",
    "--stage",
    "setup",
    "--profile",
    "admin",
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);
