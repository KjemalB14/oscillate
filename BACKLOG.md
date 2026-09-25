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
by chapter 1 (`NOTES.md` → *Chapter 1 closed: go*).

### Chapter 1 — The terminal holds (go/no-go): closed 2026-09-25, **go**

Both slices shipped (below). The results and the verdict are in `NOTES.md`.

### Chapter 2 — Every session, one click away (ends in /Applications)

- [ ] **1. The session model, Rust only, no UI.**
  - The `claude` resolver: `claude_bin()` exists (`claude.rs`, `-lic`, returns the
    login PATH too). Add caching, since one call costs ~1s, and tests against a fake
    `claude`.
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
  - **← in a pane opens agent view in place** (`NOTES.md`, chapter 1 slice 2). From
    there the same PTY can attach a different session, which breaks invariant 3. Run
    attach in the session's own `cwd`, so agent view never asks for trust in `$HOME`,
    and treat the child's exec into `claude agents` as a detach.
  - On PTY exit, reset xterm's input modes (mouse, focus, kitty flags) so a dead pane
    sends nothing.
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
- [ ] **Move `@xterm/*` from the 6.1.0 betas to 6.1.0 stable** once it ships. The
  betas are pinned exactly for the kitty keyboard protocol (`NOTES.md`, chapter 1
  slice 2).
- [ ] **Branch name and PR status colors** on the badge, once the thread view is reading
  transcripts anyway.

## Undecided — needs a decision before it's work

- [ ] **The LRU cap on live PTYs.** Decide from chapter 1's per-PTY measurements. One
  attached pane measured 220–224 MiB idle and 240 MiB mid-stream, against 156 MiB for
  a shell pane. `claude attach` itself is ~65 MiB, and it idles at ~3% CPU. The cost of
  each extra xterm instance in WebContent is not measured yet.
- [ ] **Whether to port clipped's e2e discipline**: the `e2e-author` agent, the spec
  lock, and the push gate. Decide when the harness arrives in chapter 2, slice 2.

## Shipped

- 2026-09-25: chapter 1, slice 2: the pane runs `claude attach <id>` through the
  `claude_bin()` resolver, with the kitty keyboard protocol on. Items 9–14 verified;
  **chapter 1 closes as a go**.
- 2026-09-25: chapter 1, slice 1: a Tauri window with xterm.js over a `portable-pty`
  login shell. Verified in the running app; results are in `NOTES.md`.
