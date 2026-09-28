/**
 * A fake `claude` for the e2e run, ported from `src-tauri/src/testutil.rs`. The app runs
 * its `claude` children with a clean environment, so the fake's behavior lives in files
 * beside it (`out`, `log`) that the tests rewrite while the app is running.
 *
 * It answers three commands, and logs each:
 * - `agents --json --all` prints `out` (`poll`).
 * - `attach <id>` runs `tty.pl`: it logs its pid and cwd (`attach <id> pid=<n> cwd=<dir>`),
 *   turns on mouse and focus reports as Claude's TUI does, and logs every byte it reads
 *   (`keys <id> <pid> <hex>`). Ctrl+Z prints `[detached from <id>]`, logs `detach`, and
 *   exits 0. ← execs `claude agents` in the same pid, as the real attach does.
 * - `agents`, agent view: logs `agents pid=<n>` and waits for its hangup.
 *
 * One fake serves the whole run, because the service launches one app: the config
 * creates it and exports its paths in `process.env`, which the workers inherit.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
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
case "$*" in
"agents --json --all") echo poll >> "$d/log"; cat "$d/out"; exit 0 ;;
"agents") exec /usr/bin/perl "$d/tty.pl" agents ;;
"attach "*) exec /usr/bin/perl "$d/tty.pl" "$@" ;;
esac
echo "unexpected: $*" >> "$d/log"
exit 2
`,
    );
    chmodSync(this.bin, 0o755);
    writeFileSync(join(this.dir, "tty.pl"), TTY_PL);
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

  /**
   * A directory that exists, for a session's `cwd`: `<fake dir>/repos/<name>`. Attach
   * runs there, and refuses a `cwd` that doesn't exist. The path is resolved (`/private/var`,
   * not `/var`), so it compares equal to what the attach reports.
   */
  repo(name: string): string {
    const dir = join(this.dir, "repos", name);
    mkdirSync(dir, { recursive: true });
    return realpathSync(dir);
  }

  /** Every `attach` the app started, oldest first. */
  attaches(id?: string): { id: string; pid: number; cwd: string }[] {
    return this.log()
      .map((l) => l.match(/^attach (\S+) pid=(\d+) cwd=(.*)$/))
      .filter((m): m is RegExpMatchArray => !!m && (!id || m[1] === id))
      .map((m) => ({ id: m[1], pid: Number(m[2]), cwd: m[3] }));
  }

  /** The pids of every agent view (`claude agents`) that ← started, oldest first. */
  agentViews(): number[] {
    return this.log()
      .map((l) => l.match(/^agents pid=(\d+)$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => Number(m[1]));
  }

  /** Every byte a fake attach for `id` read from its PTY, in order (optionally one pid's). */
  keys(id: string, pid?: number): Buffer {
    const parts = this.log()
      .map((l) => l.split(" "))
      .filter((f) => f[0] === "keys" && f[1] === id && (pid === undefined || f[2] === String(pid)))
      .map((f) => Buffer.from(f[3], "hex"));
    return Buffer.concat(parts);
  }

  /**
   * The fake's processes alive right now, from `ps`: `attach` pids by session id, and
   * agent-view pids. Zombies don't count.
   */
  running(): { attach: Map<string, number[]>; agentView: number[] } {
    const out = execFileSync("ps", ["-axo", "pid=,stat=,command="], { encoding: "utf8" });
    const attach = new Map<string, number[]>();
    const agentView: number[] = [];
    const tty = join(this.dir, "tty.pl");
    for (const line of out.split("\n")) {
      const m = line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/);
      if (!m || m[2].startsWith("Z") || !m[3].includes(tty)) continue;
      const args = m[3].slice(m[3].indexOf(tty) + tty.length).trim().split(" ");
      if (args[0] === "attach") attach.set(args[1], [...(attach.get(args[1]) ?? []), Number(m[1])]);
      else if (args[0] === "agents") agentView.push(Number(m[1]));
    }
    return { attach, agentView };
  }

  /** How many times the app has run `claude agents --json --all` since launch. */
  polls(): number {
    return this.log().filter((l) => l === "poll").length;
  }

  /** Every line the fake logged (see the top of this file), `unexpected: <args>` for anything else. */
  log(): string[] {
    return readFileSync(join(this.dir, "log"), "utf8").split("\n").filter(Boolean);
  }

  /** Marks the log, so a failure brief shows where a test began. */
  mark(note: string) {
    appendFileSync(join(this.dir, "log"), `# ${note}\n`);
  }
}

/**
 * The fake's terminal side, in Perl (always in /usr/bin on macOS) because it needs raw
 * mode and byte-at-a-time reads. `attach <id>` and `agents` are one script, so ← can exec
 * into agent view in the same pid, and `ps` can tell the two apart by their arguments.
 */
const TTY_PL = String.raw`use strict;
use warnings;
use Cwd qw(getcwd);
use IO::Handle;
my ($d) = $0 =~ m{^(.*)/[^/]*$};
sub say_log { open my $l, ">>", "$d/log" or die; print $l "@_\n"; close $l }
STDOUT->autoflush(1);
system("stty raw -echo");
if ($ARGV[0] eq "agents") {
    say_log("agents pid=$$");
    print "fake agent view\r\n";
    1 while sysread(STDIN, my $buf, 4096);
    exit 0;
}
my $id = $ARGV[1];
say_log("attach $id pid=$$ cwd=" . getcwd());
print "fake attach $id\r\n";
print "\e[?1000h\e[?1006h\e[?1004h";
while (sysread(STDIN, my $buf, 4096)) {
    say_log("keys $id $$ " . unpack("H*", $buf));
    if ($buf =~ /\x1a/) {
        print "\r\n[detached from $id]\r\n";
        say_log("detach $id pid=$$");
        exit 0;
    }
    exec("$d/claude", "agents") if $buf =~ /\e\[D|\eOD/;
}
`;
