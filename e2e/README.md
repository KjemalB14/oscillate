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
  beside itself, never env vars. It answers three commands and logs each one (any other
  arguments log `unexpected: …`):
  - `agents --json --all` prints the file `out` and logs `poll`.
  - `attach <id>` runs `tty.pl`, a Perl keylogger. It logs `attach <id> pid=<n>
    cwd=<dir>` and turns on mouse and focus reports, as Claude's TUI does. Then it logs
    every byte it reads, as `keys <id> <pid> <hex>`.
    - Ctrl+Z prints `[detached from <id>]`, logs `detach`, and exits 0.
    - ← execs `claude agents` **in the same pid**, as the real attach does
      (`NOTES.md`, *← is an `exec`*).
  - `agents` (agent view) logs `agents pid=<n>` and waits to be hung up.
- **`helpers/app.ts`** is what specs import:
  - `show(fixture)` sets the answer, touches the watched directory, and waits for the
    app to have polled it.
  - `fake.setOut`, `fake.touch`, `fake.polls`, and `nextPoll(timeoutMs)` returns how
    long the next poll took. Use them for timing claims.
  - `attachable(id, { repo?, name? })` is an entry for `show([...])` that the app can
    attach. Its `cwd` is a real directory, `fake.repo(repo)`. Ids are letters and
    digits only; the app refuses anything else.
  - `fake.attaches(id?)`, `fake.agentViews()` and `fake.keys(id, pid?)` read the log.
    `fake.running()` reads `ps`: the live `attach` pids by session id, and the live
    agent-view pids.
  - `press(...keys)` types into the focused terminal pane: `"ArrowLeft"`, `"Ctrl+Z"`,
    `"Escape"`, `"Enter"`, or any text. **Don't use `browser.keys()` in a pane.** This
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
- **Fixture `cwd`s don't exist**, so a click on one of their sessions shows the "no
  longer exists" message and attaches nothing. Build attachable lists with
  `attachable()`.
- **`fixtures/`** are `claude agents --json --all` outputs:
  - `all-states.json`: every UI state, two repos both named `beta`, and two
    terminal-tab entries (a copy of the Rust fixture).
  - `deep-collision.json`: `a/x/repo` vs `b/x/repo`.
  - `empty.json`.
