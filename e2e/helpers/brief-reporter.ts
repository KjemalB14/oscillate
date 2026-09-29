/**
 * Records each test's outcome as a JSON line in `e2e/.results/tests.jsonl`. The config's
 * `onComplete` turns those into the one summary line and, on failure, `brief.md`.
 * Each spec file runs in its own worker, so reporters append rather than overwrite.
 * A failed hook is recorded as a failure too: mocha skips the rest of its suite without
 * reporting those tests, so otherwise the run would look green with tests missing.
 */
import WDIOReporter, { type HookStats, type TestStats } from "@wdio/reporter";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RESULTS } from "./results.js";

const specPath = (spec?: string) => (spec?.startsWith("file:") ? fileURLToPath(spec) : spec);

export default class BriefReporter extends WDIOReporter {
  constructor(options: object) {
    super({ ...options, stdout: false });
  }

  private record(test: TestStats | HookStats, outcome: "passed" | "failed" | "skipped", title?: string) {
    const file = `${RESULTS}/tests.jsonl`;
    mkdirSync(dirname(file), { recursive: true });
    const error = test.errors?.[0] ?? test.error;
    appendFileSync(
      file,
      JSON.stringify({
        outcome,
        spec: specPath(this.runnerStat?.specs?.[0]),
        title: title ?? (test as TestStats).fullTitle,
        ms: test.duration,
        error: error ? String(error.message ?? error).slice(0, 2000) : undefined,
      }) + "\n",
    );
  }

  onTestPass(test: TestStats) {
    this.record(test, "passed");
  }

  onTestFail(test: TestStats) {
    this.record(test, "failed");
  }

  onTestSkip(test: TestStats) {
    this.record(test, "skipped");
  }

  onHookEnd(hook: HookStats) {
    if (hook.error || hook.errors?.length) this.record(hook, "failed", `hook: ${hook.parent} ${hook.title}`);
  }
}
