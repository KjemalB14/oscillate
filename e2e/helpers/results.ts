import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const RESULTS = join(ROOT, "e2e", ".results");

interface TestLine {
  outcome: "passed" | "failed" | "skipped";
  spec?: string;
  title: string;
  ms?: number;
  error?: string;
}

export function resetResults() {
  rmSync(RESULTS, { recursive: true, force: true });
  mkdirSync(RESULTS, { recursive: true });
}

/** Prints one line; on failure writes `brief.md`, the only file a failing run needs read. */
export function summarize(fakeLog: string[]): number {
  const file = join(RESULTS, "tests.jsonl");
  const tests: TestLine[] = existsSync(file)
    ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const count = (o: TestLine["outcome"]) => tests.filter((t) => t.outcome === o).length;
  const failed = tests.filter((t) => t.outcome === "failed");
  const line = `e2e: ${count("passed")} passed, ${failed.length} failed, ${count("skipped")} skipped`;

  if (failed.length > 0 || tests.length === 0) {
    const brief = [
      `# e2e failure brief`,
      ``,
      tests.length === 0
        ? `No test reported a result: the app or the harness failed before any test ran. ` +
          `The run's logs are in \`e2e/.results/logs/\`.`
        : line,
      ``,
      ...failed.flatMap((t) => [
        `## ${t.title}`,
        ``,
        `Spec: \`${t.spec ? relative(ROOT, t.spec) : "?"}\``,
        ``,
        "```",
        t.error ?? "(no message)",
        "```",
        ``,
      ]),
      `## The fake claude's log (last 40 lines)`,
      ``,
      "```",
      ...fakeLog.slice(-40),
      "```",
      ``,
    ].join("\n");
    writeFileSync(join(RESULTS, "brief.md"), brief);
    console.log(`${line} — read e2e/.results/brief.md`);
    return 1;
  }
  console.log(`${line}${recordGreen(tests) ? " (green recorded for this commit)" : ""}`);
  return 0;
}

const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

/**
 * The merge gate's evidence (`.claude/e2e-merge-gate.sh`): after a green run of the whole
 * suite on a clean checkout, the commit's tree is appended to `<git-common-dir>/e2e-green`.
 * A run of one spec, of a `.check.ts`, or over uncommitted changes records nothing.
 */
function recordGreen(tests: TestLine[]): boolean {
  const onDisk = readdirSync(join(ROOT, "e2e")).filter((f) => f.endsWith(".spec.ts"));
  const ran = new Set(tests.map((t) => relative(join(ROOT, "e2e"), t.spec ?? "")));
  const whole = onDisk.length > 0 && ran.size === onDisk.length && onDisk.every((f) => ran.has(f));
  try {
    if (!whole || git("status", "--porcelain") !== "") return false;
    const common = git("rev-parse", "--path-format=absolute", "--git-common-dir");
    appendFileSync(join(common, "e2e-green"), `${git("rev-parse", "HEAD^{tree}")}\n`);
    return true;
  } catch {
    return false;
  }
}
