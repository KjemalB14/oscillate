/**
 * A fake `claude` for the e2e run, ported from `src-tauri/src/testutil.rs`. The app runs
 * its `claude` children with a clean environment, so the fake's behavior lives in files
 * beside it (`out`, `log`) that the tests rewrite while the app is running.
 *
 * It answers five commands, and logs each:
 * - `agents --json --all` prints `out` (`poll`).
 * - `--bg ...` runs `bg.pl`: it logs its pid, start time, cwd and every argument
 *   byte-exact (`bg pid=<n> at=<ms> cwd=<dir> argv=<hex>,<hex>,...`). In a directory
 *   `untrust()` listed, it then fails as a real one does there: the stderr Claude Code
 *   2.1.284 printed (`fixtures/bg-untrusted-stderr.txt`, with this cwd), exit 1.
 *   Otherwise it answers what `answerBg` set: by default the stdout a real one printed
 *   (`fixtures/bg-stdout.txt`), exit 0.
 * - `claude` with no arguments, the interactive trust prompt, runs `trust.pl`: it logs
 *   `trust pid=<n> at=<ms> cwd=<dir> argv=` and shows a trust prompt. "1" or Enter
 *   accepts: the cwd leaves the untrusted list, and it exits 0 on `/exit` + Enter. "2" or
 *   Esc is "No, exit": it exits 1 and the cwd stays untrusted. Every signal that could end
 *   or stop it (all but SIGWINCH, which a resize sends) is logged as `trust-signal`, and
 *   the fatal ones then end it. Each exit is logged as `trust-exit`.
 * - `attach <id>` runs `tty.pl`: it logs its pid and cwd (`attach <id> pid=<n> cwd=<dir>`),
 *   turns on mouse and focus reports as Claude's TUI does, and logs every byte it reads
 *   (`keys <id> <pid> <hex>`). Ctrl+Z prints `[detached from <id>]`, logs `detach`, and
 *   exits 0. ← logs `agents pid=<n>` and execs `claude agents` in the same pid, as the
 *   real attach does.
 * - `agents`, agent view: repaints an 8KB screen every 10ms, and answers a hangup by
 *   writing 32KB before it exits, as the real one does, so it exits only if the app
 *   keeps reading.
 *
 * One fake serves the whole run, because the service launches one app: the config
 * creates it and exports its paths in `process.env`, which the workers inherit.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const DIR_VAR = "OSCILLATE_E2E_FAKE_DIR";
/** The id in `fixtures/bg-stdout.txt`, the output of a real `claude --bg`. */
const CAPTURED_BG_ID = "c59cf1b2";
/** Where the captured untrusted stderr names its directory; `bg.pl` puts its cwd there. */
const CWD_MARK = "@@CWD@@";
/** The file `touch()` rewrites; `claudeDirTree()` leaves it out. */
const TOUCHED = join("sessions", "4242.json");

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

  /** What `OSCILLATE_DATA_DIR` points at: the app keeps `repos.json` here. */
  get dataDir(): string {
    return join(this.dir, "data");
  }

  /** The environment the app is launched with, by the service and by `relaunch()`. */
  appEnv(): Record<string, string> {
    return {
      OSCILLATE_CLAUDE_BIN: this.bin,
      OSCILLATE_CLAUDE_DIR: this.claudeDir,
      OSCILLATE_DATA_DIR: this.dataDir,
      OSCILLATE_E2E_PICK: join(this.dir, "pick"),
    };
  }

  private create() {
    const d = this.dir.replace(/'/g, `'\\''`);
    writeFileSync(
      this.bin,
      `#!/bin/sh
d='${d}'
case "$*" in
"agents --json --all") echo poll >> "$d/log"; cat "$d/out"; exit 0 ;;
"--bg "*) exec /usr/bin/perl "$d/bg.pl" "$@" ;;
"") [ $# -eq 0 ] && exec /usr/bin/perl "$d/trust.pl" ;;
"agents") exec /usr/bin/perl "$d/tty.pl" agents ;;
"attach "*) exec /usr/bin/perl "$d/tty.pl" "$@" ;;
esac
echo "unexpected: $*" >> "$d/log"
exit 2
`,
    );
    chmodSync(this.bin, 0o755);
    writeFileSync(join(this.dir, "tty.pl"), TTY_PL);
    writeFileSync(join(this.dir, "bg.pl"), BG_PL);
    writeFileSync(join(this.dir, "trust.pl"), TRUST_PL);
    // The captured error names the throwaway repo it came from; each answer names its own.
    const untrustedErr = readFileSync(join(FIXTURES, "bg-untrusted-stderr.txt"), "utf8");
    const capturedDir = untrustedErr.match(/ in (\S+) once /)![1];
    writeFileSync(join(this.dir, "bg-untrusted-err"), untrustedErr.replace(capturedDir, CWD_MARK));
    writeFileSync(join(this.dir, "untrusted"), "");
    mkdirSync(join(this.claudeDir, "sessions"), { recursive: true });
    mkdirSync(join(this.claudeDir, "jobs"), { recursive: true });
    writeFileSync(join(this.dir, "log"), "");
    this.setOut("all-states");
    this.answerBg({ id: CAPTURED_BG_ID });
    this.pick(null);
    writeFileSync(join(this.dir, "claude-dir-baseline.json"), JSON.stringify(this.claudeDirTree()));
  }

  /**
   * What the next `claude --bg` answers. By default its stdout is what a real
   * `claude --bg` printed (Claude Code 2.1.284, colors and all), with `id` in place of
   * the real id; stderr is empty and it exits 0. With a non-zero `exit`, stdout defaults
   * to empty. `delayMs` holds the answer back.
   */
  answerBg(opts: { id?: string; stdout?: string; stderr?: string; exit?: number; delayMs?: number }) {
    const captured = readFileSync(join(FIXTURES, "bg-stdout.txt"), "utf8");
    const failing = (opts.exit ?? 0) !== 0;
    const stdout = opts.stdout ?? (failing ? "" : captured.replaceAll(CAPTURED_BG_ID, opts.id ?? CAPTURED_BG_ID));
    writeFileSync(join(this.dir, "bg-out"), stdout);
    writeFileSync(join(this.dir, "bg-err"), opts.stderr ?? "");
    writeFileSync(join(this.dir, "bg-exit"), String(opts.exit ?? 0));
    writeFileSync(join(this.dir, "bg-delay"), String((opts.delayMs ?? 0) / 1000));
  }

  /**
   * Marks `dir` untrusted: `--bg` there fails with the real trust error until the fake
   * trust prompt is accepted in it. Every directory is trusted by default. The list
   * outlives a spec: a spec that untrusts a directory must `trust()` it before it ends.
   */
  untrust(dir: string) {
    const real = realpathSync(dir);
    if (!this.untrusted().includes(real)) appendFileSync(join(this.dir, "untrusted"), `${real}\n`);
  }

  /** Takes `dir` off the untrusted list, as accepting the trust prompt does. */
  trust(dir: string) {
    const real = realpathSync(dir);
    const rest = this.untrusted().filter((d) => d !== real);
    writeFileSync(join(this.dir, "untrusted"), rest.map((d) => `${d}\n`).join(""));
  }

  /** The directories `--bg` currently fails in, resolved. */
  untrusted(): string[] {
    return readFileSync(join(this.dir, "untrusted"), "utf8").split("\n").filter(Boolean);
  }

  /**
   * Every interactive trust `claude` the app started, oldest first: its pid, start time,
   * cwd, and argv after `claude` (empty when it's run with no arguments, as it should be).
   */
  trusts(): { pid: number; at: number; cwd: string; argv: string[] }[] {
    return this.log()
      .map((l) => l.match(/^trust pid=(\d+) at=(\d+) cwd=(.*) argv=([0-9a-f,]*)$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => ({
        pid: Number(m[1]),
        at: Number(m[2]),
        cwd: m[3],
        argv: m[4] ? m[4].split(",").map((h) => Buffer.from(h, "hex").toString("utf8")) : [],
      }));
  }

  /** Every signal a trust `claude` received (optionally one pid's), oldest first. */
  trustSignals(pid?: number): { pid: number; sig: string }[] {
    return this.log()
      .map((l) => l.match(/^trust-signal pid=(\d+) sig=(\w+)$/))
      .filter((m): m is RegExpMatchArray => !!m && (pid === undefined || m[1] === String(pid)))
      .map((m) => ({ pid: Number(m[1]), sig: m[2] }));
  }

  /**
   * How each trust `claude` ended: `accepted` (trust accepted, then `/exit`), `declined`
   * ("No, exit"), `signal-<NAME>`, or `eof` (its terminal closed).
   */
  trustExits(): { pid: number; how: string }[] {
    return this.log()
      .map((l) => l.match(/^trust-exit pid=(\d+) how=(\S+)$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => ({ pid: Number(m[1]), how: m[2] }));
  }

  /** Every `claude --bg` the app ran, oldest first: argv after `claude`, byte-exact. */
  bgs(): { pid: number; at: number; cwd: string; argv: string[] }[] {
    return this.log()
      .map((l) => l.match(/^bg pid=(\d+) at=(\d+) cwd=(.*) argv=([0-9a-f,]*)$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => ({
        pid: Number(m[1]),
        at: Number(m[2]),
        cwd: m[3],
        argv: m[4].split(",").map((h) => Buffer.from(h, "hex").toString("utf8")),
      }));
  }

  /**
   * How the app's next "Add repo…" folder picker is answered: a directory path, or
   * `null` to cancel. The e2e build reads this instead of showing the native dialog.
   */
  pick(dir: string | null) {
    writeFileSync(join(this.dir, "pick"), dir ?? "");
  }

  /** The app's `repos.json` as it is on disk: its `repos`, or `null` if there's no file. */
  reposJson(): string[] | null {
    const file = join(this.dataDir, "repos.json");
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).repos : null;
  }

  /**
   * Every path under the watched Claude dir, with a hash of each file's bytes ("dir" for
   * a directory), sorted, leaving out the file `touch()` rewrites. Compare two of these to
   * show the app wrote nothing there (invariant 5).
   */
  claudeDirTree(): Record<string, string> {
    const tree: Record<string, string> = {};
    const walk = (rel: string) => {
      for (const name of readdirSync(join(this.claudeDir, rel)).sort()) {
        const path = join(rel, name);
        if (path === TOUCHED) continue;
        if (statSync(join(this.claudeDir, path)).isDirectory()) {
          tree[path] = "dir";
          walk(path);
        } else {
          tree[path] = createHash("sha256").update(readFileSync(join(this.claudeDir, path))).digest("hex");
        }
      }
    };
    walk("");
    return tree;
  }

  /** `claudeDirTree()` as it was when the fake was made, before the app launched. */
  claudeDirBaseline(): Record<string, string> {
    return JSON.parse(readFileSync(join(this.dir, "claude-dir-baseline.json"), "utf8"));
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

  /**
   * The pids of every agent view (`claude agents`) that ← started, oldest first. Logged
   * at the exec, which is when agent view appears.
   */
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
   * The fake's processes alive right now, from `ps`: `attach` pids by session id,
   * agent-view pids, and trust `claude` pids. Zombies don't count.
   */
  running(): { attach: Map<string, number[]>; agentView: number[]; trust: number[] } {
    const out = execFileSync("ps", ["-axo", "pid=,stat=,command="], { encoding: "utf8" });
    const attach = new Map<string, number[]>();
    const agentView: number[] = [];
    const trust: number[] = [];
    const tty = join(this.dir, "tty.pl");
    const trustPl = join(this.dir, "trust.pl");
    for (const line of out.split("\n")) {
      const m = line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/);
      if (!m || m[2].startsWith("Z")) continue;
      if (m[3].endsWith(trustPl)) trust.push(Number(m[1]));
      if (!m[3].includes(tty)) continue;
      const args = m[3].slice(m[3].indexOf(tty) + tty.length).trim().split(" ");
      if (args[0] === "attach") attach.set(args[1], [...(attach.get(args[1]) ?? []), Number(m[1])]);
      else if (args[0] === "agents") agentView.push(Number(m[1]));
    }
    return { attach, agentView, trust };
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
    # Like the real one, it answers a hangup by writing before it exits (restoring the
    # terminal), so it only gets out once the app reads what it wrote.
    my $screen = ("fake agent view " . ("x" x 60) . "\r\n") x 100;
    $SIG{HUP} = sub { print $screen x 4; exit 0 };
    while (1) {
        print $screen;
        my $in = "";
        vec($in, fileno(STDIN), 1) = 1;
        if (select($in, undef, undef, 0.01)) { sysread(STDIN, my $buf, 4096) or exit 0 }
    }
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
    if ($buf =~ /\e\[D|\eOD/) {
        # Logged before the exec: that is when agent view appears, and the app may hang
        # this pid up before the exec'd agent view gets to run a line.
        say_log("agents pid=$$");
        exec("$d/claude", "agents");
    }
}
`;

/**
 * The fake `--bg`. It logs first, then waits `bg-delay` seconds, then answers `bg-out`,
 * `bg-err` and `bg-exit`. Arguments are hex, so quotes, `$`, backticks and newlines
 * survive the log exactly.
 */
const BG_PL = String.raw`use strict;
use warnings;
use Cwd qw(getcwd);
use Time::HiRes qw(time sleep);
my ($d) = $0 =~ m{^(.*)/[^/]*$};
my $at = int(time() * 1000);
sub slurp { open my $f, "<", "$d/$_[0]" or return ""; local $/; my $s = <$f>; close $f; $s }
open my $l, ">>", "$d/log" or die;
print $l "bg pid=$$ at=$at cwd=" . getcwd() . " argv=" . join(",", map { unpack("H*", $_) } @ARGV) . "\n";
close $l;
my $cwd = getcwd();
if (grep { $_ eq $cwd } split /\n/, slurp("untrusted")) {
    (my $err = slurp("bg-untrusted-err")) =~ s/\@\@CWD\@\@/$cwd/;
    binmode STDERR;
    print STDERR $err;
    exit 1;
}
my $delay = slurp("bg-delay");
sleep($delay) if $delay > 0;
binmode STDOUT;
binmode STDERR;
print STDOUT slurp("bg-out");
print STDERR slurp("bg-err");
exit(slurp("bg-exit") + 0);
`;

/**
 * The fake interactive `claude`, sitting at the workspace-trust prompt. It exists to be
 * answered, never signalled: every signal that could end or stop it is logged first
 * (SIGWINCH, which a resize sends, is not), and the fatal ones then end it as they would
 * end the real one.
 */
const TRUST_PL = String.raw`use strict;
use warnings;
use Cwd qw(getcwd);
use IO::Handle;
use Time::HiRes qw(time);
my ($d) = $0 =~ m{^(.*)/[^/]*$};
sub say_log { open my $l, ">>", "$d/log" or die; print $l "@_\n"; close $l }
STDOUT->autoflush(1);
my $cwd = getcwd();
say_log("trust pid=$$ at=" . int(time() * 1000) . " cwd=$cwd argv=" . join(",", map { unpack("H*", $_) } @ARGV));
my %fatal = map { $_ => 1 } qw(HUP INT QUIT TERM PIPE ALRM USR1 USR2);
for my $sig (qw(HUP INT QUIT TERM PIPE ALRM USR1 USR2 TSTP TTIN TTOU CONT)) {
    $SIG{$sig} = sub {
        say_log("trust-signal pid=$$ sig=$sig");
        return unless $fatal{$sig};
        say_log("trust-exit pid=$$ how=signal-$sig");
        $SIG{$sig} = "DEFAULT";
        kill $sig, $$;
    };
}
sub untrusted { open my $f, "<", "$d/untrusted" or return (); my @l = grep { length } map { chomp; $_ } <$f>; close $f; @l }
system("stty raw -echo");
print "\e[2J\e[H fake claude\r\n\r\n Do you trust the files in this folder?\r\n\r\n $cwd\r\n\r\n";
print " > 1. Yes, proceed\r\n   2. No, exit\r\n\r\n Enter to confirm, Esc to exit\r\n";
my ($accepted, $typed) = (0, "");
# Perl runs signal handlers between ops, and macOS restarts a blocked read, so the read
# waits in a select with a timeout: a handler runs within 50ms of its signal.
while (1) {
    my $in = "";
    vec($in, fileno(STDIN), 1) = 1;
    next unless select(my $ready = $in, undef, undef, 0.05) > 0;
    sysread(STDIN, my $buf, 4096) or last;
    say_log("trust-keys pid=$$ " . unpack("H*", $buf));
    if (!$accepted) {
        if ($buf =~ /^[1\r]/) {
            $accepted = 1;
            my @rest = grep { $_ ne $cwd } untrusted();
            open my $f, ">", "$d/untrusted" or die;
            print $f map { "$_\n" } @rest;
            close $f;
            say_log("trust-accept pid=$$ cwd=$cwd");
            print "\r\n Trusted. Type /exit to leave.\r\n> ";
        } elsif ($buf =~ /^(2|\e)/) {
            say_log("trust-decline pid=$$ cwd=$cwd");
            say_log("trust-exit pid=$$ how=declined");
            exit 1;
        }
        next;
    }
    print $buf;
    $typed .= $buf;
    if ($typed =~ m{/exit\r}) {
        say_log("trust-exit pid=$$ how=accepted");
        exit 0;
    }
}
say_log("trust-exit pid=$$ how=eof");
exit 0;
`;
