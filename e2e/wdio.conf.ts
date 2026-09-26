/**
 * The e2e harness: WebdriverIO drives the real app through `@wdio/tauri-service`'s
 * embedded driver (a WebDriver server compiled into the `e2e` build), against a fake
 * `claude` and a temp watched directory. It never runs the real `claude` or watches the
 * real `~/.claude` (invariants 4 and 5). `npm run e2e` builds, then runs this.
 */
import { join } from "node:path";
import BriefReporter from "./helpers/brief-reporter.js";
import { FakeClaude } from "./helpers/fake-claude.js";
import { ROOT, RESULTS, resetResults, summarize } from "./helpers/results.js";

const fake = FakeClaude.shared();

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: [join(ROOT, "e2e", "*.spec.ts")],
  maxInstances: 1,
  capabilities: [{ browserName: "tauri" } as WebdriverIO.Capabilities],
  services: [
    [
      "@wdio/tauri-service",
      {
        driverProvider: "embedded",
        appBinaryPath: join(ROOT, "src-tauri", "target", "e2e", "debug", "oscillate"),
        env: { OSCILLATE_CLAUDE_BIN: fake.bin, OSCILLATE_CLAUDE_DIR: fake.claudeDir },
      },
    ],
  ],
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 30_000 },
  reporters: [BriefReporter],
  logLevel: "error",
  outputDir: join(RESULTS, "logs"),
  waitforTimeout: 3000,

  onPrepare() {
    resetResults();
  },

  onComplete() {
    process.exitCode = summarize(fake.log());
  },
};
