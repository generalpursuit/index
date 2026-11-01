// Lists the browser tests that passed only on retry, as warnings and in the CI run's summary.
import { appendFileSync, readFileSync } from "node:fs";

type Spec = { title: string; file: string; line: number; tests: { status: string }[] };
type Suite = { specs?: Spec[]; suites?: Suite[] };

const report: { suites: Suite[] } = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const flaky: Spec[] = [];
const visit = (suite: Suite) => {
  for (const spec of suite.specs ?? [])
    if (spec.tests.some((test) => test.status === "flaky")) flaky.push(spec);
  suite.suites?.forEach(visit);
};
report.suites.forEach(visit);

for (const spec of flaky)
  console.log(
    `::warning file=apps/web/e2e/${spec.file},line=${spec.line},title=Flaky browser test::${spec.title} passed only on retry.`,
  );
const summary = [
  "### Flaky browser tests",
  "",
  ...(flaky.length
    ? [
        "These passed only on retry. Fix them rather than relying on the retry.",
        "",
        ...flaky.map((spec) => `- \`${spec.file}:${spec.line}\` ${spec.title}`),
      ]
    : ["None in this run."]),
].join("\n");
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
else console.log(summary);
