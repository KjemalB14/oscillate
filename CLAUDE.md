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
- committed, merged into `main`, and `main` pushed to `origin`
  (github.com/KjemalB14/oscillate, public). The merge is gated: a PreToolUse hook
  (`.claude/e2e-merge-gate.sh`) refuses it until the branch's exact tree has a green
  `npm run e2e`, or its commits say `E2E: none — <why>`. Only `main` is pushed, never
  working branches;
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

**Chapter 3, *Start and end sessions from the app*, is closed** (2026-09-30). Its
decisions and what it didn't prove are in `NOTES.md` → *Chapter 3 closed*.
- Rows sort by `sortKey`, the `startedAt` the app first saw for each key
  (`sessions::FirstSeen`, applied by the poll thread), so they never move while it runs.
- "+" on a group opens `src/NewSessionBox.tsx`: `newsession.rs` runs `claude --bg` with
  the prompt and mode, then selects the new id once it's listed. "Add repo…" and "Remove
  from list" keep `repos.json` in the app data dir (`repos.rs`; `OSCILLATE_DATA_DIR` in
  e2e).
- `--bg`'s `Workspace not trusted` opens `src/TrustPane.tsx`: interactive `claude` in
  that `cwd`, outside the pool. Its exit makes the box retry once.
  - **The app never signals the trust `claude`.** `pty.rs` refuses it in
    `Pty::close_with`, and it keeps the pane across a reload. Quit, the Quit menu item
    and window close are refused while it runs. The Quit item is the app's own, because
    the stock one can't be refused.
- A right-click on a background row opens `Sidebar.tsx`'s menu: Stop while live, Remove
  always, and only Remove confirms (`src/rowActions.ts`). `end_session` (`lib.rs`,
  `endsession.rs`) closes the row's attach through `pty::end_attaches` and waits for its
  reap. Only then does it run exactly `claude stop|rm <id>`, and no attach is admitted
  until that returns. An `rm` refusal shows verbatim under the row.
- The fake answers `--bg`, `stop` and `rm` with real captured bytes, models per-directory
  trust, and logs signals and attach exits. `relaunch()` and `rightClick()` are harness
  helpers (`e2e/README.md`).
- **The slice-4 app is installed** in `/Applications` (2026-09-30), and every hand check
  (items 12, 17, 22) passed in a release build.

**Chapter 4, *It tells you when it needs you*, is closed** (2026-10-01), and with it
**MVP 1**. Its decisions and what it didn't prove are in `NOTES.md` → *Chapter 4 closed*.
- `attention.rs` decides what notifies: transitions into needs you, done or failed,
  with launch as the baseline, and quiet for the selected session while the window is
  key. `notifications.rs` posts through our own `UNUserNotificationCenter` delegate
  (objc2) in a `.app`, and posts nothing in `tauri dev`.
  - A tap emits `open-session`, which the page opens as a row click.
  - The page reports its selection with `set_visible_session`.
  - The Dock badge counts needs-you sessions.
- `pr_links.rs` adds `prs` to every listed session from its job's `state.json`. The
  sidebar shows the newest as `#N`, then `+k`, and `open_pr` opens only links the app
  is listing.
- The e2e build logs notifications, badge changes and opened links instead of reaching
  macOS (`e2e/README.md`).
- **The installed app is chapter 5, slice 3's build** (`f82cbac`, installed 2026-10-04).
  Launched as
  `/Applications/Oscillate.app/Contents/MacOS/oscillate 2>log`, it logs each notify
  decision, each tap, each opened link, and each PR-link miss.

**Next: MVP 2** (`BACKLOG.md` → *Later*). Nothing is open. Pick what comes first from
daily use, and open it with `/decide`. `/decide` was started on 2026-10-04 and paused
for a few more sessions of use. The evidence so far is in `NOTES.md` → *First daily use*.
**Chapter 5, *The UI pass*, is open** beside it (2026-10-04): five slices drawn from
zeron, from tokens to a ⌘K palette. Its decisions and criteria are in `PLAN-ui-pass.md`.
- **Slice 1, *Look*, is merged.** Every color is a role in `src/palette.ts`, written as CSS
  variables by `src/theme.ts`, and follows macOS light and dark live, terminals
  included. Geist and JetBrains Mono are bundled (`src/fonts.css`).
  `npm run theme:check` measures contrast, and checks that xterm can parse every
  terminal color. Its hand items passed after a fix. **The terminal is opaque**
  (`TERMINAL_ALPHA = 1`) until slice 2 makes dim text read under translucent WebGL.
- **Slice 2, *Chrome*, is merged.**
  - `glass.rs` puts `NSGlassEffectView` behind a transparent window.
    `OSCILLATE_GLASS=off`, or no such class, keeps it opaque.
  - The title bar is an overlay. Its traffic lights sit in the sidebar's 40px strip,
    beside the toggle. `src/PaneHeader.tsx` names the selected session, and its empty
    space drags the window.
  - The sidebar resizes within 208–400px, and ⌃⌘S collapses it. `layout.rs` keeps
    both in `layout.json`.
  - **The terminal stays opaque on WebGL.** The see-through terminal waits on the
    speed gate (`npm run e2e:speed`), which is parked without a real recorded turn.
    The alphas wait on measuring the glass (`BACKLOG.md`, *The see-through terminal
    and the glass alphas*).
- **Slice 3, *Rows*, is merged.**
  - A row has two lines: the indicator, the name and the time since `updatedAt`
    (`src/ago.ts`), then `waitingFor` or the state's words with the PR chips. Rows
    still never move.
  - Working is a 3×3 cell wave, and needs you breathes. `theme.ts` mirrors Reduce
    motion as `data-motion="reduce"` on the root, which every animation keys off.
  - A group header is the repo's avatar, its name and its count. `avatars.rs` reads
    the origin from the repo's git config, following a worktree's `.git` file.
  - **The avatar is the app's one unprompted outbound request:**
    `https://github.com/<owner>.png`, fetched once through `NSURLSession`, and cached in
    the app data dir's `avatars/`. Any miss is a folder glyph. E2e builds fetch only
    from the harness's local server (`OSCILLATE_E2E_AVATAR_BASE`).
- **Slice 4, *Motion*, is built** on `slice4-motion`, not yet merged.
  - Every duration is a variable in `src/motion.css`'s catalog, and all are 0 under
    `data-motion="reduce"`. Only the state indicators' loops name their own.
  - The row menu, PR menu, remove confirm, new-session box and quit notice sit on one
    `.frosted` surface. Its blur is subtle until the glass alphas lower `raised`.

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
- Claude can drive the window itself with `~/.claude/scripts/drive-window` (`--help`).
  - **From a foreground `claude` in Ghostty**, Ghostty needs Accessibility, Screen &
    System Audio Recording, and Automation → System Events.
  - **From a `claude --bg` job**, macOS asks on behalf of the app hosting its attach.
    For a job attached in the installed Oscillate.app, both grants are on
    (2026-10-04).
  - Clicking a real notification banner stays the author's job. Everything around it
    is checked from the app's stderr log and the process list.

## The invariants

Breaking one is a regression even when nothing fails.

1. **Sessions belong to the daemon.** Oscillate spawns only `claude attach`,
   `claude --bg`, `claude stop`/`rm`, `claude agents --json`, and the one-off interactive
   `claude` used to accept workspace trust. It never keeps a Claude session alive by
   itself.
2. **Session state comes from `claude agents --json`.** The single exception is the
   job-state adapter (`pr_links.rs`). It reads the undocumented job `state.json` for PR
   links and `updatedAt`, and must fail soft: a parse miss means no badge or no time,
   never an error.
3. **Never two PTYs attached to the same session.**
4. **Every `claude` invocation goes through one resolver.** It honors
   `OSCILLATE_CLAUDE_BIN`, so tests run against a fake `claude` and never touch real
   sessions or usage.
5. **Oscillate never edits `~/.claude.json` or anything under `~/.claude/`.** It reads
   the session and job directories only as a trigger to re-poll. The one exception is
   invariant 2's: `pr_links.rs` reads each listed job's `state.json`, and only reads it.

## Decisions (locked)

The reasoning and rejected alternatives for each are in `NOTES.md`, dated 2026-09-25.

- **Built on the daemon.** Terminal-tab sessions show dimmed with a hint to run `/bg`.
- **Rust + Tauri 2 + xterm.js + portable-pty.**
- **Terminal first.** The read-only thread view is MVP 2.
- **One window, sessions grouped by repo.**
- **Badges are a PR link only**, through the fail-soft adapter.
