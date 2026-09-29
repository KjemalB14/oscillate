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

### Chapter 2 — Every session, one click away (ends in /Applications): closed 2026-09-28

All four slices shipped (below). The results are in `NOTES.md`.

### Chapter 3 — Start and end sessions from the app: open

Decided 2026-09-28. The decisions, rejections and acceptance criteria are in
`PLAN-new-sessions.md`.

- [x] **1. Rows stay still.** Shipped 2026-09-28 (below).
- [x] **2. New session.** Shipped 2026-09-28 (below). Item 12 passed by hand after the
  merge.
  - A "+" on a repo group opens a prompt box, with a prompt and a permission mode, that
    runs `claude --bg` in that repo, then selects and attaches the new session.
  - "Add repo…" opens a folder picker, and chosen repos persist in the app's own
    `repos.json`, with "Remove from list" on their group.
- [x] **3. The trust pane.** Shipped 2026-09-28, except item 17, a hand check in the
  release app that is still open.
  - An untrusted repo opens a pane running interactive `claude` so you can accept
    trust. When it exits, the app retries once with the prompt it kept.
  - The app never kills that process, and refuses Cmd+Q while it runs.
- [ ] **4. Stop and remove.** A context menu runs `claude stop` or `claude rm` after
  closing the PTY. Only Remove asks for confirmation. An `rm` refusal is shown verbatim,
  with no `--discard-unpushed`.

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
- [ ] **Check the daemon's PATH when an Oscillate click starts it.** Item 24's daemon
  clause couldn't be triggered, because the daemon was already up, hosting the session
  that ran the check (`NOTES.md`, *Chapter 2, slice 4*). The next time no background
  session exists and a click in the Finder-launched app starts the daemon, run
  `ps eww <daemon pid>` and confirm its PATH is the login shell's.
- [ ] **An e2e claim for the sidebar's load path.** Only an incidental one covers
  `sessions_snapshot` today (`NOTES.md`, *Chapter 2, slice 2, session B*). A claim
  that reloads the page and sees the current list without the fake changing would
  make it deliberate. `e2e-author` writes it.

## Undecided — needs a decision before it's work

Nothing open. (Clipped's e2e discipline was decided on 2026-09-26: ported, with the
gate on merge instead of push. See `NOTES.md` → *Chapter 2 closed*.)

## Shipped

- 2026-09-28: chapter 3, slice 2: a new session from the app. "+" on a repo group runs
  `claude --bg` with the prompt and mode, then selects and attaches the new session.
  "Add repo…" and "Remove from list" keep the app's own `repos.json`. Items 5–11 pass
  under `npm run e2e`, each claim proved red by a break. Item 12 (by hand, release app)
  is still open. The results are in `NOTES.md`.
- 2026-09-28: chapter 3, slice 1: rows stay still. Each row keeps the `startedAt` the
  app first saw for its key, for the life of the app process, and a webview reload
  keeps the order. Items 1–4 pass under `npm run e2e`, each proved red by a break. The
  results are in `NOTES.md`.
- 2026-09-28: chapter 2, slice 4: ship to the Dock. `Oscillate.app` with its own icon,
  ad-hoc signed by the build, installed in `/Applications`. Launched from Finder, it
  lists every session about 1s after its window appears, and a click attaches with the
  login shell's PATH. Items 23–24 verified by hand; the daemon clause of 24 wasn't
  triggered (Later). **Chapter 2 closes.** The results are in `NOTES.md`.
- 2026-09-28: chapter 2, slice 3: click to attach, with a pool of panes. Attach runs
  in the session's `cwd`; ← and Ctrl+Z detach; a vanished session's PTY closes; quit
  leaves no attach; an LRU cap of 6 within the budget (893 MiB, ≤ 2% CPU). Items 13–18,
  20 and 22 pass under `npm run e2e`, each spec proved red by a break; 15, 19 and 21
  were also verified against real `claude`. The results are in `NOTES.md`.
- 2026-09-27: chapter 2, slice 2: the sidebar. Repo groups (disambiguated,
  collapsible, counted), rows with a state dot, name and `waitingFor`, dimmed
  terminal-tab rows, and an empty state. Items 9–12 pass under `npm run e2e`, with
  specs by `e2e-author`, each proved red by a break. The results are in `NOTES.md`.
- 2026-09-25: chapter 2, slice 1: the session model. The cached resolver, the 2s poll,
  the filtered file-watch, `sessions-changed`, and the state mapping. Items 1–8 pass
  under `cargo test`; the results are in `NOTES.md`.
- 2026-09-25: chapter 1, slice 2: the pane runs `claude attach <id>` through the
  `claude_bin()` resolver, with the kitty keyboard protocol on. Items 9–14 verified;
  **chapter 1 closes as a go**.
- 2026-09-25: chapter 1, slice 1: a Tauri window with xterm.js over a `portable-pty`
  login shell. Verified in the running app; results are in `NOTES.md`.
