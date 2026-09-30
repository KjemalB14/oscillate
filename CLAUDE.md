# Oscillate

A macOS app for moving between parallel Claude Code sessions. A sidebar lists every
session grouped by repo, and clicking one shows the real Claude Code terminal UI for it,
hosted in the app. For the author's own daily use; feedback from that use drives what
comes next.

**Oscillate is a thin client over Claude Code's own supervisor daemon**, the engine
behind `claude agents`. The daemon runs the sessions; Oscillate lists them and attaches
to them. Everything downstream follows from that, and it is the first decision to
re-read before changing anything.

## Closing a body of work

**When a chapter or slice is finished, say so and hand off.** Do not roll straight into
the next one. Finished means:
- committed, and merged into `main` (there is no remote). The merge is gated: a
  PreToolUse hook (`.claude/e2e-merge-gate.sh`) refuses it until the branch's exact
  tree has a green `npm run e2e`, or its commits say `E2E: none — <why>`;
- `CLAUDE.md` states the new state;
- `NOTES.md` carries the reasoning;
- `BACKLOG.md` is ticked;
- any open `PLAN-*.md` says what it has and has not proved.

Then **offer `/clear` in one line** and stop. Every turn re-sends the whole conversation,
and a session that starts from the docs costs a fraction of one that starts from a
transcript.

### Always end with a handoff prompt

**Before offering `/clear`, run the `handoff` skill.** Its output must be readable by a
session that was not here: no "the bug we found", no "as discussed". **If writing the
handoff needs something the docs do not have, that gap goes into the docs first.** The
handoff points into these files; it never copies their reasoning.

## Docs map

- `CLAUDE.md` (this file): the authoritative state, the invariants, and the locked
  decisions. Read it first, and in full, every session. **Keep it short.**
- `BACKLOG.md`: the single backlog of what is not built yet, including the MVP 1 roadmap
  as chapters and slices. New ideas go here.
- `NOTES.md`: the running log, newest first. It holds decisions **with the alternatives
  rejected**, what was tried, what a thing cost to find out, and repeatable workflows.
  **Why any rule holds is here, not beside it.**
- `PLAN-<chapter>.md`: exists only while a chapter is open, and is deleted with its
  final slice. It opens with the **decision head section** written by `/decide`: the
  question, what was chosen and why, what was rejected and why, what is still open, and
  **the acceptance criteria**. Those are observable, measured statements of what the
  running app will show. Implementation goes below the `agreed` marker. A chapter does
  not start until that head exists and is agreed.

## Current state

**Chapter 1, *The terminal holds*, is closed: go.** A Tauri 2 window runs xterm.js over
`portable-pty` (`src-tauri/src/pty.rs`, `src/TerminalPane.tsx`), attaching background
sessions through the resolver (`claude::resolver()`, `src-tauri/src/claude.rs`). All 14
acceptance items were verified against Ghostty. The verdict and what it didn't prove
are in `NOTES.md` → *Chapter 1 closed: go*.

**Chapter 2, *Every session, one click away*, is closed** (2026-09-28). Its decisions
and what it didn't prove are in `NOTES.md` → *Chapter 2 closed*.
- `poll.rs` runs `claude agents --json --all` every 2s through the cached resolver, and
  `watch.rs` re-polls on changes under `sessions/` or `jobs/`. The frontend gets the
  list as `sessions-changed` and `sessions_snapshot`, mapped by `sessions.rs`.
- `src/Sidebar.tsx` renders it grouped by repo (`src/groups.ts`).
- A row click attaches the session in its own `cwd`. Each opened session keeps its pane
  and PTY (`src/App.tsx`), up to 6, evicting the least recently viewed. ← and Ctrl+Z
  detach; `pty.rs`'s argv watch kills agent view.
- `e2e/sidebar-*.spec.ts` and `e2e/attach-*.spec.ts` cover it. Specs are written by
  `e2e-author`, in a session **started from this directory**. A session started
  anywhere else loads neither the agent nor the hooks.
- **`Oscillate.app` is installed in `/Applications`**, ad-hoc signed by the build, with
  its icon drawn in `src-tauri/icons/app-icon.svg`. Launched from Finder, it finds
  `claude` through the login shell. Daily use and feedback start here.

**Chapter 3, start and end sessions from the app, is open** (decided 2026-09-28).
`PLAN-new-sessions.md` holds its decisions and acceptance criteria, in four slices:
frozen row order, "+" and "Add repo…", the trust pane, then Stop and Remove.
- **Slice 1 has shipped:** rows sort by `sortKey`, the `startedAt` the app first saw for
  each key (`sessions::FirstSeen`, applied by the poll thread).
- **Slice 2 has shipped**, and item 12 passed by hand in the reinstalled app.
  - "+" opens `src/NewSessionBox.tsx`: `newsession.rs` runs `claude --bg`, then the
    new id is selected once it's listed.
  - "Add repo…" and "Remove from list" keep `repos.json` in the app data dir
    (`repos.rs`; `OSCILLATE_DATA_DIR` in e2e).
  - The fake answers `--bg` with real captured bytes, and `relaunch()` restarts the
    app mid-spec (`e2e/README.md`).
- **Slice 3 has shipped**, and item 17 passed by hand in the reinstalled app.
  - `--bg`'s `Workspace not trusted` opens `src/TrustPane.tsx`: interactive `claude` in
    that `cwd`, outside the pool. Its exit makes the box retry once.
  - **The app never signals the trust `claude`.** `pty.rs` refuses it in
    `Pty::close_with`, and it keeps the pane across a reload. Quit, the Quit menu item
    and window close are refused while it runs. The Quit item is the app's own, because
    the stock one can't be refused.
  - The fake models per-directory trust and a trust prompt that logs every signal
    (`e2e/README.md`).
- **Slice 4 has shipped; item 22 (by hand) is still open.**
  - A right-click on a background row opens `Sidebar.tsx`'s menu: Stop while live,
    Remove always. Remove asks in one line under the row (`src/rowActions.ts`).
  - `end_session` (`lib.rs`, `endsession.rs`) closes the row's attach through
    `pty::end_attaches` and waits for its reap. Only then does it run exactly
    `claude stop|rm <id>`, and no attach is admitted until that returns.
  - An `rm` refusal (stdout, exit 1) shows verbatim under the row. The fake answers
    `stop` and `rm`, logs attach exits, and `rightClick()` sends the `contextmenu` this
    driver doesn't (`e2e/README.md`).
  - Next: item 22 in the reinstalled release app, then close chapter 3.

- Dev: `npm run tauri dev`. Release binary: `npx tauri build --no-bundle`.
- Install: quit the app, then `npx tauri build` and `ditto
  src-tauri/target/release/bundle/macos/Oscillate.app /Applications/Oscillate.app`.
  Check disk space first (`df -h /System/Volumes/Data`).
- Tests: `cargo test` in `src-tauri`, against fixtures and a fake `claude`
  (`testutil.rs`); they never run the real one.
- E2E: `npm run e2e` (WDIO against a fake `claude` and a temp watched directory, which
  `OSCILLATE_CLAUDE_DIR` points the watch at). **Specs (`e2e/*.spec.ts`) are written by
  the `e2e-author` agent only**; a hook refuses everyone else. The rest of `e2e/` is the
  harness. See `e2e/README.md`.
- `@xterm/*` is pinned to 6.1.0 betas for the kitty keyboard protocol. Don't
  downgrade to 6.0: Esc Esc stops working in Claude.
- Rust lives in `~/.cargo/bin`.
- Claude can drive the window itself with `~/.claude/scripts/drive-window` (`--help`),
  but not from a `claude --bg` job, which isn't allowed to send Apple Events.

## The invariants

Breaking one is a regression even when nothing fails.

1. **Sessions belong to the daemon.** Oscillate spawns only `claude attach`,
   `claude --bg`, `claude stop`/`rm`, `claude agents --json`, and the one-off interactive
   `claude` used to accept workspace trust. It never keeps a Claude session alive by
   itself.
2. **Session state comes from `claude agents --json`.** The single exception is the PR
   link adapter (`pr_links.rs`), which reads the undocumented job `state.json` and must
   fail soft: a parse miss means no badge, never an error.
3. **Never two PTYs attached to the same session.**
4. **Every `claude` invocation goes through one resolver.** It honors
   `OSCILLATE_CLAUDE_BIN`, so tests run against a fake `claude` and never touch real
   sessions or usage.
5. **Oscillate never edits `~/.claude.json` or anything under `~/.claude/`.** It reads
   the session and job directories only as a trigger to re-poll.

## Decisions (locked)

The reasoning and rejected alternatives for each are in `NOTES.md`, dated 2026-09-25.

- **Built on the daemon.** Terminal-tab sessions show dimmed with a hint to run `/bg`.
- **Rust + Tauri 2 + xterm.js + portable-pty.**
- **Terminal first.** The read-only thread view is MVP 2.
- **One window, sessions grouped by repo.**
- **Badges are a PR link only**, through the fail-soft adapter.
