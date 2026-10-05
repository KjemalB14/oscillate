# End-to-end tests

WebdriverIO drives the real app through `@wdio/tauri-service`'s **embedded** driver: a
WebDriver server compiled into the app by the `e2e` cargo feature. It is the only
provider that works on macOS without a paid key. The app runs against a **fake
`claude`** and a **temp watched directory**. It never runs the real `claude` or watches
the real `~/.claude` (invariants 4 and 5).

## Commands

- `npm run e2e`: builds the e2e app, then runs every `e2e/*.spec.ts`. It prints one line.
  - On failure it writes `e2e/.results/brief.md`, the only file to read.
  - A green run of the whole suite on a clean checkout records the commit's tree for the
    merge gate (`.claude/e2e-merge-gate.sh`).
- `npm run e2e -- --spec e2e/<file>.spec.ts`: one spec.
- `npm run e2e:snapshot`: writes `e2e/.results/snapshot.txt`, the app's accessibility
  tree after the fake answered `SNAPSHOT_FIXTURE` (default `all-states`).
- `npm run e2e:check`: the harness's own smoke test (`harness.check.ts`).
- `npm run e2e:build`: only the build. It's quiet unless it fails; the log is
  `src-tauri/target/e2e/build.log`.

The build is a debug build in its own target dir (`src-tauri/target/e2e`), so it never
makes `npm run tauri dev` recompile. It takes about a minute cold, and a few seconds
when nothing changed.

## Who writes what

- **`*.spec.ts` are written by the `e2e-author` agent only.** A hook refuses everyone
  else (`.claude/e2e-spec-lock.sh`), and specs come from `PLAN-*.md` acceptance
  criteria, quoted verbatim.
- **Everything else here is the harness**, owned by the coding agent: `helpers/`,
  `fixtures/`, the `.check.ts` files, and `wdio.conf.ts`.

## How a run works

- **One app runs for the whole suite.** The service launches it once. A spec sets what
  the fake answers and waits for the app to poll it; it never relaunches the app.
- **`helpers/fake-claude.ts`** is a TS port of `src-tauri/src/testutil.rs`'s fake. The
  app runs its `claude` children with a clean environment, so the fake reads files
  beside itself, never env vars. It logs every command it answers (any other
  arguments log `unexpected: …`). It answers seven:
  - `agents --json --all` prints the file `out` and logs `poll`.
  - `--bg …` logs `bg pid=<n> at=<ms> cwd=<dir> argv=<hex>,…`, every argument hex-encoded
    so quotes, `$`, backticks and newlines survive. Then it answers what
    `fake.answerBg()` set. By default that's the stdout a real `claude --bg` printed
    (Claude Code 2.1.284, `fixtures/bg-stdout.txt`, colors included), with the given id,
    and exit 0. It starts no session and writes nothing under the watched dir.
    - **In a directory `fake.untrust()` listed**, `--bg` fails as a real one does there,
      whatever `answerBg` says. It exits 1 with empty stdout, and stderr is the line a
      real one printed (`fixtures/bg-untrusted-stderr.txt`, naming its own cwd):
      ``Workspace not trusted. Run `claude` in <dir> once and accept the trust prompt,
      then retry.``
  - `claude` with **no arguments** is the interactive trust prompt, run by `trust.pl`.
    It logs `trust pid=<n> at=<ms> cwd=<dir> argv=` and shows a trust prompt.
    - `"1"` or Enter accepts. The cwd leaves the untrusted list, and it then exits 0 on
      `/exit` + Enter. `"2"` or Esc is "No, exit": it exits 1, and the cwd stays untrusted.
    - It logs every signal that could end or stop it, as `trust-signal pid=<n>
      sig=<NAME>`. SIGWINCH is left out, because a resize sends it. HUP, INT, QUIT, TERM,
      PIPE, ALRM, USR1 and USR2 then end it, as they would end the real one. Every exit
      is logged as `trust-exit pid=<n> how=<accepted|declined|signal-NAME|eof>`.
  - `attach <id>` runs `tty.pl`, a Perl keylogger. It logs `attach <id> pid=<n> at=<ms>
    cwd=<dir>` and turns on mouse and focus reports, as Claude's TUI does. Then it logs
    every byte it reads, as `keys <id> <pid> <hex>`.
    - Every exit is logged as `attach-exit <id> pid=<n> at=<ms> how=<detach|eof|signal-NAME>`,
      and a signal then ends it as before. Two exits leave no line: ←'s exec (agent view
      logs `agents-exit` instead) and a SIGKILL. Its read waits in a 50ms `select`, as
      `trust.pl`'s does, or the handlers would never run.
    - `fake.lingerOnHangup(ms)` makes every later attach wait `ms` after a hangup
      before it exits, as a slow one would. Without it the fake exits within ~50ms,
      faster than the app can start another `claude`, so an app that runs `stop` without
      waiting for the attach to be reaped still looks right. It outlives a spec; put it
      back to 0.
    - Ctrl+Z prints `[detached from <id>]`, logs `detach`, and exits 0.
    - ← logs `agents pid=<n>`, then execs `claude agents` **in the same pid**, as the
      real attach does (`NOTES.md`, *← is an `exec`*). The log comes first because
      the app can hang the pid up before agent view has run a line.
  - `stop <id>` and `rm <id>` run `end.pl`. It logs `<stop|rm> pid=<n> at=<ms> cwd=<dir>
    argv=<hex>,… attached=<pids>`, where `attached` is every live `attach <id>` pid (from
    `ps`) at its start. Then it acts on the file `out` as the daemon would:
    - `stop` turns a `working` or `blocked` entry into `stopped` and drops its `status`,
      `pid` and `waitingFor`, as the real one did (Claude Code 2.1.285). A `done` entry
      stays `done`. It prints `stopped <id>` and exits 0.
    - `rm` answers what `fake.answerRm()` set. By default it prints `removed <id>`, exits
      0 and drops the entry. With a non-zero exit it prints the refusal a real `rm` printed
      **on stdout** (`fixtures/rm-refused-stdout.txt`, naming the id) and leaves the entry.
    - An id `out` doesn't list fails with the real `No job matching` line, exit 1.
  - `agents` (agent view) repaints an 8KB screen every 10ms. It answers a hangup by
    writing 32KB before it exits, as the real one does, so it only exits if the app
    keeps reading the PTY after the hangup (`NOTES.md`, slice 3, *the reader stopped
    reading*).
- **`helpers/app.ts`** is what specs import:
  - `show(fixture)` sets the answer, touches the watched directory, and waits for the
    app to have polled it.
  - `fake.setOut`, `fake.touch`, `fake.polls`, and `nextPoll(timeoutMs)` returns how
    long the next poll took. Use them for timing claims.
  - `attachable(id, { repo?, name? })` is an entry for `show([...])` that the app can
    attach. Its `cwd` is a real directory, `fake.repo(repo)`. Ids are letters and
    digits only; the app refuses anything else.
  - `fake.attaches(id?)` (with each start time `at`), `fake.attachExits(id?)`,
    `fake.agentViews()` and `fake.keys(id, pid?)` read the log. `fake.sizes(id, pid?)`
    is every size an attach saw its PTY at (`rows`, `cols`): one at start, and one per
    resize. The last one is the PTY's size now.
    `fake.running()` reads `ps`: the live `attach` pids by session id, and the live
    agent-view pids.
  - `fake.answerBg({ id, stdout?, stderr?, exit?, delayMs? })` sets the next `--bg`
    answer. A non-zero `exit` defaults stdout to empty. `fake.bgs()` reads back every
    `--bg`: `{ pid, at, cwd, argv }`, with `argv` decoded and byte-exact.
  - `fake.untrust(dir)` makes `--bg` fail there with the trust error. `fake.trust(dir)`
    undoes it, as accepting the fake prompt does, and `fake.untrusted()` lists them.
    `fake.trusts()` reads back every trust `claude` (`{ pid, at, cwd, argv }`, with
    `argv` empty when it got no arguments). `fake.trustSignals(pid?)` and
    `fake.trustExits()` read the rest, and `fake.running().trust` lists the live ones.
  - `fake.answerRm({ stdout?, stderr?, exit? })` sets what every later `rm` answers;
    `fake.answerRm()` puts back the default. `fake.rmRefusal(id)` is the exact refusal
    text the fake prints for `id`. `fake.stops()` and `fake.rms()` read back each one:
    `{ pid, at, cwd, argv, attached }`.
  - `fake.argvs()` is every argv the fake was run with, as far as its log shows (polls,
    attaches, `--bg`, trust, `stop`, `rm`, and anything unexpected as one string).
  - `rightClick(el)` right-clicks as WebKit does: `mousedown`, `contextmenu`, `mouseup`,
    button 2, at the element's center. **Don't use `click({ button: "right" })`:** this
    driver sends only the `mousedown` and `mouseup`, so no context menu ever opens.
  - `fake.pick(dir | null)` answers the app's next "Add repo…" folder picker (`null`
    cancels). The e2e build reads it instead of opening the native dialog.
    `fake.reposJson()` reads the app's `repos.json` (`null` if there's none).
  - **Notifications can't appear in the e2e build**, which has no app bundle, so its
    notifier logs instead (`OSCILLATE_E2E_NOTIFY_LOG`). `fake.notifications()` reads the
    log back in order:
    - `{ op: "post", at, id, title, subtitle, body }`: one notification, whose `id` is
      the session's id;
    - `{ op: "remove", at, id }`: its delivered notification removed, which happens
      whenever the page selects that session;
    - `{ op: "badge", at, count }`: the Dock badge, with `count` `null` when it's cleared.
  - `fake.focus("key" | "background" | "minimized")` sets what the app takes its
    window's focus to be when it decides whether the selected session is on screen. It
    defaults to `key`, and a spec that changes it puts it back.
  - `tapNotification(id)` and `dismissNotification(id)` run the notification delegate's
    own handler through an e2e-only command, as a tap or a dismissal on a real banner
    would.
  - `fake.job(id, content)` writes `<watched>/jobs/<id>/state.json`, which the app reads
    PR links from. `content` is an object or raw text, and `null` removes the job. The
    write wakes the app's poll, as a real job's does. `fake.prState([42, 43])` builds one
    naming those PRs, oldest first, the way Claude Code writes `children[]`.
    - **Remove every job you write before the spec ends:** later specs compare the
      watched tree with the baseline.
    - `fake.claudeDirExpected()` is the baseline plus the jobs `job()` has written. Compare
      `claudeDirTree()` with it while jobs are in place.
    - A job's `updatedAt` is the row's time. Write it as Claude Code does,
      `{ updatedAt: "2026-10-04T23:17:49.030Z", ... }`; any other form is no time.
  - **Avatars never come from GitHub in the e2e build.** It fetches from the base URL in
    the file `fake.avatarBaseFile` names, and with no file it fetches nothing.
    `helpers/avatar-server.ts` is a local stand-in. Its header says what the app
    remembers: each owner is looked up once per app process, and only hits are cached on
    disk.
    - `AvatarServer.start()` serves `/<owner>.png` and writes the file. `answer()` picks
      the reply, `requests()` reads them back, `offline()` and `online()` switch, and
      `stop()` removes the file.
    - `fake.gitRepo(name, origin | null)` makes `fake.repo(name)` a git repo, with only a
      `.git/config`. `fake.gitWorktree(repo, name)` makes a worktree of it outside it,
      and `attachable(id, { cwd })` uses one.
    - `fake.avatarCache()` lists the cached owners in the app data dir, and
      `fake.clearAvatarCache()` empties it.
  - **Reduced motion can't be switched from WebDriver.** The page mirrors macOS's
    setting as `data-motion="reduce"` on `<html>`, and every animation keys off that, so
    a spec sets the attribute and deletes it after.
  - `fake.opened()` lists every link the app sent to the opener, in order. The e2e build
    logs them (`OSCILLATE_E2E_OPEN_LOG`) instead of opening a browser.
  - `fake.claudeDirTree()` hashes every path under the watched Claude dir, except the
    file `touch()` rewrites. `fake.claudeDirBaseline()` is that tree from before the app
    launched.
  - `relaunch()` quits the app (SIGTERM) and starts a new process with the same
    environment, then opens a new WebDriver session on it. `appPids()` lists the running
    e2e app's pids.
  - `press(...keys)` types into the focused terminal pane: `"ArrowLeft"`, `"Ctrl+Z"`,
    `"Escape"`, `"Enter"`, `"Cmd+Q"`, or any text. **Don't use `browser.keys()` in a pane.**
    In the running app, the menu's accelerator takes a real Cmd+Q before the page sees
    it. `press("Cmd+Q")` reaches the page's own handler, which calls the same quit
    command. This
    driver puts the character code in `keyCode`, so xterm.js reads `x` as `x` plus F9,
    and Ctrl+Z as Ctrl+F11.
- **The app polls every 2s**, and within about 100ms of a change to
  `<watched>/sessions/*.json` (`fake.touch()`). After a poll whose list changed, it
  emits `sessions-changed` and the sidebar re-renders.
- **Locators, two traps** (`NOTES.md`, *Chapter 2, slice 2, session B*):
  - A bare `*=text` is WDIO's partial *link-text* selector and matches only `<a>`. Use
    `li*=text` or an xpath `contains(text(), …)`.
  - `not.toBeDisplayed()` and `not.toBeExisting()` pass on a locator that never
    matches. Assert the positive first, on the same locator.
  - `snapshot.txt` omits elements with no text, such as a group header's chevron span.
- **State that outlives a spec.** `repos.json` is kept in the run's temp data dir for
  the whole run, and `relaunch()` keeps it. A spec that adds a repo must remove it
  before it ends: `sidebar-rows.spec.ts` expects no groups at all under `empty`. The
  same goes for the untrusted list (`fake.trust()` what you `untrust()`), and for
  `fake.answerRm()`: a spec that makes `rm` refuse must call `fake.answerRm()` before it
  ends. `fake.lingerOnHangup()` too.
  - **A trust pane left open blocks quitting**, and `relaunch()`'s SIGTERM would hang
    up its `claude`. A spec that opens one must answer it before it ends. After
  `relaunch()`, everything the app kept only in memory is gone, such as sort keys and
  open panes.
- **A `<select>`'s options can't be chosen under this driver.** Neither
  `selectBy…()` nor clicking an `<option>` changes the value, so the app has no
  `<select>`.
- **Fixture `cwd`s don't exist**, so a click on one of their sessions shows the "no
  longer exists" message and attaches nothing. Build attachable lists with
  `attachable()`.
- **`fixtures/`** are `claude agents --json --all` outputs:
  - `all-states.json`: every UI state, two repos both named `beta`, and two
    terminal-tab entries (a copy of the Rust fixture).
  - `deep-collision.json`: `a/x/repo` vs `b/x/repo`.
  - `empty.json`.
- `fixtures/avatar.png` is an 8×8 PNG that `AvatarServer` answers with.
- The other `fixtures/` are real `claude` output the fake answers with: `bg-stdout.txt`,
  `bg-untrusted-stderr.txt`, and `rm-refused-stdout.txt` (Claude Code 2.1.285, against a
  throwaway session whose worktree had a commit on no remote).
