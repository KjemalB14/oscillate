/**
 * A fake `claude` for the e2e run, ported from `src-tauri/src/testutil.rs`. The app runs
 * its `claude` children with a clean environment, so the fake's behavior lives in files
 * beside it (`out`, `log`) that the tests rewrite while the app is running.
 *
 * One fake serves the whole run, because the service launches one app: the config
 * creates it and exports its paths in `process.env`, which the workers inherit.
 */
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const DIR_VAR = "OSCILLATE_E2E_FAKE_DIR";

export class FakeClaude {
  private constructor(readonly dir: string) {}

  /** The run's one fake: created on first call in the launcher, found by path after. */
  static shared(): FakeClaude {
    const existing = process.env[DIR_VAR];
    if (existing) return new FakeClaude(existing);
    const fake = new FakeClaude(mkdtempSync(join(tmpdir(), "oscillate-e2e-")));
    fake.create();
    process.env[DIR_VAR] = fake.dir;
    return fake;
  }

  /** What `OSCILLATE_CLAUDE_BIN` points at. */
  get bin(): string {
    return join(this.dir, "claude");
  }

  /** What `OSCILLATE_CLAUDE_DIR` points at: the app watches `sessions/` and `jobs/` here. */
  get claudeDir(): string {
    return join(this.dir, "dot-claude");
  }

  private create() {
    const d = this.dir.replace(/'/g, `'\\''`);
    writeFileSync(
      this.bin,
      `#!/bin/sh
d='${d}'
[ "$*" = "agents --json --all" ] || { echo "unexpected: $*" >> "$d/log"; exit 2; }
echo poll >> "$d/log"
cat "$d/out"
`,
    );
    chmodSync(this.bin, 0o755);
    mkdirSync(join(this.claudeDir, "sessions"), { recursive: true });
    mkdirSync(join(this.claudeDir, "jobs"), { recursive: true });
    writeFileSync(join(this.dir, "log"), "");
    this.setOut("all-states");
  }

  /**
   * What the next `claude agents --json --all` prints: a fixture name from
   * `e2e/fixtures/` (without `.json`), or the entries themselves.
   */
  setOut(what: string | object[]) {
    const json = typeof what === "string" ? readFileSync(join(FIXTURES, `${what}.json`)) : JSON.stringify(what);
    writeFileSync(join(this.dir, "out"), json);
  }

  /** Changes a session file in the watched directory, as Claude Code does on a status change. */
  touch() {
    const file = join(this.claudeDir, "sessions", "4242.json");
    writeFileSync(file, JSON.stringify({ touchedAt: Date.now() }));
  }

  /** How many times the app has run `claude agents --json --all` since launch. */
  polls(): number {
    return this.log().filter((l) => l === "poll").length;
  }

  /** Every line the fake logged: `poll` per run, `unexpected: <args>` for anything else. */
  log(): string[] {
    return readFileSync(join(this.dir, "log"), "utf8").split("\n").filter(Boolean);
  }

  /** Marks the log, so a failure brief shows where a test began. */
  mark(note: string) {
    appendFileSync(join(this.dir, "log"), `# ${note}\n`);
  }
}
