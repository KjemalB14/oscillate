# Oscillate — backlog

**This is the only backlog.** Not GitHub Issues, not a second list in `CLAUDE.md`. One
tracker, because two drift apart.

`CLAUDE.md` records what the app *is* today. This file records what it isn't yet.
`NOTES.md` records *why*: the reasoning behind these items lives there, dated.

**How to use it:** open the top chapter in **Next** with `/decide`, which writes
`PLAN-<chapter>.md` with its acceptance criteria. Then branch, build one slice per PR,
tick it, and move the line into the dated **Shipped** list at the bottom in the same
commit. New ideas that arrive mid-task go into **Later** or **Undecided** instead of
derailing the branch.

---

## Next — MVP 1

The roadmap was agreed 2026-09-25; the reasoning is in `NOTES.md` → *Planning MVP 1*.
Four chapters, in dependency order. The frontend is React + TypeScript (Vite), confirmed
by chapter 1's `/decide` (`PLAN-terminal.md`).

### Chapter 1 — The terminal holds (go/no-go)

It goes first because it is the assumption everything else rests on: if the embedded
terminal feels worse than Ghostty (the baseline; iTerm isn't installed), nothing else
matters. Acceptance criteria are in `PLAN-terminal.md`.

- [ ] **1. Tauri shell + xterm.js + a PTY running the login shell.** No Claude involved,
  so a terminal-plumbing bug has one origin.
- [ ] **2. The pane runs `claude attach <id>`** for an id passed in by hand. Acceptance
  is checked by hand and recorded in `NOTES.md` under *Verified in the running app*:
  - ← on an empty prompt and Ctrl+Z both detach.
  - Ctrl+C interrupts once.
  - Option acts as Meta.
  - The mouse wheel scrolls the fullscreen view.
  - Cmd+C / Cmd+V copy and paste.
  - OSC 8 links open in the browser.
  - Truecolor, emoji and wide characters render correctly.
  - Resizing reflows cleanly.
  - Memory and CPU per attached PTY are measured.

  **Closes with a go/no-go:** if two or more items can't be fixed, reopen the stack
  decision (a native Rust renderer) before chapter 2.

### Chapter 2 — Every session, one click away (ends in /Applications)

- [ ] **1. The session model, Rust only, no UI.**
  - The `claude` resolver: login shell, cached, with an `OSCILLATE_CLAUDE_BIN` override.
  - A serialized 2s poll of `claude agents --json --all`.
  - A file-watch on `~/.claude/sessions` and `~/.claude/jobs`, used only as a re-poll
    trigger.
  - A diff that emits `sessions-changed`.
  - One pure function maps each entry to what the UI shows: working · needs you · done ·
    failed · stopped · paused · terminal-tab.
  - Tests run over fixture JSON and a fake `claude`.
- [ ] **2. Sidebar rendering only.**
  - Repo groups by `cwd` (basename, disambiguated), collapsible, with counts.
  - Each session shows a state dot, name and `waitingFor`. Terminal-tab sessions are
    dimmed with a "run /bg to open here" hint.
  - An empty state.
  - The e2e harness arrives here: WebdriverIO + `@wdio/tauri-service` + the fake
    `claude`.
- [ ] **3. Click to attach, with a PTY pool.**
  - One PTY and one xterm instance per opened session; switching never reattaches.
  - A detached PTY shows "Detached — click to reattach".
  - A session that vanishes from the list closes its PTY.
  - Quitting the app detaches all PTYs and leaves the sessions running.
  - Settle the LRU cap from chapter 1's numbers.
- [ ] **4. Ship to the Dock.**
  - `tauri build`, ad-hoc signing, `/Applications`, an icon.
  - Verify the resolver finds `claude` when the app is launched from Finder.
  - **Daily use and feedback start here.**

### Chapter 3 — Start and end sessions from the app

- [ ] **1. New session.**
  - A "+" on a repo group opens a prompt box that runs `claude --bg` in that repo, then
    selects and attaches the new session.
  - "Add repo…" opens a folder picker, and chosen repos persist in the app's own
    `repos.json`.
  - An untrusted repo opens a PTY running interactive `claude` so you can accept trust,
    then the app retries with the prompt it kept.
- [ ] **2. Stop and remove.** A context menu runs `claude stop` or `claude rm` after
  closing the PTY. An `rm` refusal is shown verbatim, with no automatic
  `--discard-unpushed`.

### Chapter 4 — It tells you when it needs you (closes MVP 1)

- [ ] **1. Notifications.**
  - Triggered on transitions into needs you, done or failed; not for the visible
    session.
  - A Dock badge shows the needs-you count.
  - Clicking a notification opens the session. `/decide` picks the community plugin or
    a native delegate.
- [ ] **2. PR link badge.**
  - `pr_links.rs` reads `children[kind=pr]` from the job's `state.json`.
  - Any parse miss means no badge.
  - Clicking opens the PR in the browser.

---

## Later — MVP 2

- [ ] **Thread view.** A read-only, custom-formatted rendering of the session transcript
  (`~/.claude/projects/<repo>/<session-id>.jsonl`), toggled against the terminal. It also
  works for terminal-tab sessions.
- [ ] **Composer box in the thread view** for plain replies. Anything that opens a
  dialog still brings the terminal forward.
- [ ] **Keyboard switching.** Cmd+1–9, Cmd+N, Cmd+[ / ].
- [ ] **Branch name and PR status colors** on the badge, once the thread view is reading
  transcripts anyway.

## Undecided — needs a decision before it's work

- [ ] **The LRU cap on live PTYs.** Decide from chapter 1's per-PTY measurements.
- [ ] **Whether to port clipped's e2e discipline**: the `e2e-author` agent, the spec
  lock, and the push gate. Decide when the harness arrives in chapter 2, slice 2.

## Shipped

Nothing yet.
