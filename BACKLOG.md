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

**Reference when deciding:** [zeron](https://github.com/zeronsh/zeron) is a close
neighbor. `/decide` should check it for features and UI before settling a chapter, but
not for architecture (`NOTES.md`, *zeron, a reference project*).

---

## Next — MVP 1

The roadmap was agreed 2026-09-25; the reasoning is in `NOTES.md` → *Planning MVP 1*.
Four chapters, in dependency order. The frontend is React + TypeScript (Vite), confirmed
by chapter 1 (`NOTES.md` → *Chapter 1 closed: go*).

### Chapter 1 — The terminal holds (go/no-go): closed 2026-09-25, **go**

Both slices shipped (below). The results and the verdict are in `NOTES.md`.

### Chapter 2 — Every session, one click away (ends in /Applications): closed 2026-09-28

All four slices shipped (below). The results are in `NOTES.md`.

### Chapter 3 — Start and end sessions from the app: closed 2026-09-30

All four slices shipped (below). The results are in `NOTES.md` → *Chapter 3 closed*.

- [x] **1. Rows stay still.** Shipped 2026-09-28 (below).
- [x] **2. New session.** Shipped 2026-09-28 (below). Item 12 passed by hand after the
  merge.
  - A "+" on a repo group opens a prompt box, with a prompt and a permission mode, that
    runs `claude --bg` in that repo, then selects and attaches the new session.
  - "Add repo…" opens a folder picker, and chosen repos persist in the app's own
    `repos.json`, with "Remove from list" on their group.
- [x] **3. The trust pane.** Shipped 2026-09-28. Item 17 passed by hand after the
  merge.
  - An untrusted repo opens a pane running interactive `claude` so you can accept
    trust. When it exits, the app retries once with the prompt it kept.
  - The app never kills that process, and refuses Cmd+Q while it runs.
- [x] **4. Stop and remove.** Shipped 2026-09-30 (below). Item 22 passed by hand after
  the merge.
  - A context menu runs `claude stop` or `claude rm` after closing the PTY. Only Remove
    asks for confirmation. An `rm` refusal is shown verbatim, with no
    `--discard-unpushed`.

### Chapter 4 — It tells you when it needs you (closes MVP 1): closed 2026-10-01

Both slices shipped (below). The results are in `NOTES.md` → *Chapter 4 closed*. **MVP 1
is complete.**

- [x] **1. Notifications and the Dock badge.** Shipped 2026-10-01 (below). Item 10 passed
  by hand after the merge.
  - Our own `UNUserNotificationCenter` delegate through objc2, not a plugin.
  - Posted on transitions into needs you, done or failed, but not at launch, and not
    for the session whose pane is selected while the window is key.
  - A tap opens the session the way a row click does. A dismissal does nothing.
  - The Dock badge shows the needs-you count. Rows stay still.
- [x] **2. PR link badge.** Shipped 2026-10-01 (below). Item 17 passed by hand after the
  merge.
  - `pr_links.rs` reads `children[kind=pr]` from the job's `state.json`.
  - The row shows the newest as `#N`, then `+k`, which opens a menu of the others.
  - Any parse miss means no chip.
  - Clicking opens the PR in the browser.

---

## Later — MVP 2

- [ ] **Try giving `claude --bg` jobs window control, once.**
  - Add the `claude.exe` binary (under nvm) to Accessibility and to Screen & System
    Audio Recording.
  - Then, from a `--bg` job, run `drive-window <pid> front` and a `shot`.
  - Doubts: Apple Events consent can't be pre-granted, and the binary's path changes on
    every update. If it fails, hand checks stay in a foreground Ghostty session
    (`CLAUDE.md`).
- [ ] **The reload test flakes in full runs** (`sidebar-order.spec.ts`, item 4, and now
  `notifications.spec.ts` item 3, which also reloads: 1 of 3 full runs, 2026-10-01). It timed out
  at 30s in 2 of 8 full runs on slice 4's branch, 0 of 4 on `main`, and 2 of 5 in slice
  3 (`NOTES.md`, *Chapter 3, slice 4*). The hang is a WebDriver `execute` across
  `location.reload()`. Next: log each `execute`'s start and end around the reload in a
  failing run, before changing anything.
- [ ] **Thread view.** A read-only, custom-formatted rendering of the session transcript
  (`~/.claude/projects/<repo>/<session-id>.jsonl`), toggled against the terminal. It also
  works for terminal-tab sessions.
- [ ] **A terminal-tab row looks like the session you want, and opens nothing.** In
  first daily use, the author clicked the dimmed `clipped-overlap` row expecting its
  in-progress session. The row's `run /bg to open here` didn't head that off (`NOTES.md`,
  *First daily use*). Decide first: a clearer hint, or the thread view (above) for these
  rows.
- [ ] **A click on a long-finished job revives it silently.** Attaching `ade5c70a`, done
  since 2026-09-08, made the daemon claim a spare process for it, and the pane showed a
  month-old idle conversation (`NOTES.md`, *First daily use*). Decide first: whether that's
  wanted, or a done row should open to something lighter.
- [ ] **Shift+Enter in the pane sends the prompt instead of a newline** (2026-10-04, daily
  use). In Ghostty it gives a newline in Claude. The pane runs xterm.js 6.1.0-beta with
  `kittyKeyboard: true`, so the guess is that it sends `\r` where Claude expects a kitty
  encoding. That's unverified. Next: log the bytes for Shift+Enter in the pane and in
  Ghostty, as chapter 1 did for Esc (`NOTES.md`, chapter 1 slice 2), before changing
  anything.
- [ ] **A worktree session groups as its own repo.** `src/groups.ts` groups by the `cwd`
  basename. So a session in `oscillate/.claude/worktrees/ui-backlog` showed as a
  `ui-backlog` group, with its own "+", instead of under `oscillate` (2026-10-04, daily
  use). Decide first:
  - How a worktree's repo is found: from the `.claude/worktrees/<name>` path, or from
    `git rev-parse --git-common-dir`, which invariant 1 doesn't allow today.
  - How the row shows the worktree's name.
  - Where the group's "+" starts a new session.
- [ ] **A worktree page: list each repo's worktrees and delete the finished ones**
  (2026-10-04, daily use). Decide first:
  - Whether `claude rm` already removes a job's worktree.
  - If not, whether the app may run `git worktree remove`, which invariant 1 doesn't
    allow today.
  - What makes a worktree safe to delete. Never `--force-remove-worktree`, and unpushed
    work blocks it, as `rm`'s refusal does.
- [ ] **Composer box in the thread view** for plain replies. Anything that opens a
  dialog still brings the terminal forward.
- [ ] **Keyboard switching.** Cmd+1–9, Cmd+N, Cmd+[ / ].
- [ ] **Say that `/exit` was taken in the trust pane.** In item 17 the author saw nothing
  change after `/exit` and typed it again. The repeat landed in the new session and
  detached it (`NOTES.md`, *Chapter 3, slice 3*). Time the gap first; then consider
  showing "Starting…" once the trust `claude` exits.
- [ ] **Dock → Quit and logout still end the app while a trust pane is open.** They send
  `terminate:`, which the app's own Quit item doesn't see, so the trust `claude` gets the
  kernel's hangup (`NOTES.md`, *Chapter 3, slice 3*).
- [ ] **An added repo whose folder is gone.** `Repos::load` keeps every stored path, so a
  deleted folder stays a group with a "+". Item 17's temp repo is still in the installed
  app's `repos.json`, and macOS will clean `$TMPDIR` under it (`NOTES.md`, *Chapter 3,
  item 22 passed*). Decide first: drop it, dim it, or refuse its "+".
- [ ] **Move `@xterm/*` from the 6.1.0 betas to 6.1.0 stable** once it ships. The
  betas are pinned exactly for the kitty keyboard protocol (`NOTES.md`, chapter 1
  slice 2).
- [ ] **Unseen markers on rows**, from zeron: a row that turned done, failed or needs
  you while you weren't looking keeps a marker until you open it. Chapter 4 left it
  out (`PLAN-notifications.md`).
- [ ] **Per-state sounds**, from zeron: separate sounds for done, needs input and
  failure. Chapter 4 uses the system default sound.
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

## Later — the UI pass, beside MVP 2

These are looks and feel only, taken from zeron's screenshots, its feature inventory and
its UI crate. None of them changes what the app does. It runs as its own chapter, opened
with `/decide` like any other, and can run while daily use and MVP 2's `/decide` carry
on. The reasoning, what was rejected, and how to run it beside daily use are in
`NOTES.md` → *The UI pass, from zeron*. The groups are in rough order, from cheapest to
most work.

**Look: tokens and type (CSS only)**
- [ ] **One neutral dark scale, not four ad-hoc greys.** Zeron is near-black and
  monochrome (`#0a0a0a`, an oklch neutral ramp, white hairlines at low alpha). Ours is
  `#1e1e1e` / `#252628` / `#333538` in `src/App.css`. Redo `:root` as a ramp: ground,
  raised, hover, selected, hairline, text, muted, faint. Keep the five state colors,
  tuned to the new ground.
- [ ] **The terminal owns a whole theme, not just its background.** `src/terminal.ts`
  sets only `background`. Give xterm `foreground`, `cursor`, `selectionBackground` and
  all 16 ANSI colors, from the same ramp, so Claude's TUI and the chrome around it read
  as one surface. Hand check: Claude's diff colors and dim text stay readable.
- [ ] **Typography.** Bundle Geist and Geist Mono (OFL, as zeron does), or decide that
  SF Pro with JetBrains Mono stays. One size scale for the chrome (11/12/13/15), with
  tabular numbers for counts and times.
- [ ] **Thin or hidden scrollbars, and edge fades on the sidebar.** A CSS mask fades
  rows at whichever edge hides more, as zeron's sidebar and palettes do.

**Rows and groups (Sidebar.tsx, presentation only; rows still never move)**
- [ ] **A richer session row.** Zeron's row is a rounded card on three lines: a muted
  meta line (`repo · 6h`), the title, and a line with the agent glyph and branch.
  Ours: the meta line from `cwd` and a relative time from `startedAt` (a ticking
  "6h", not a timestamp), the name, then `waitingFor` or the PR chip. A selected row
  gets a filled card with 8px corners. Keep every role, `aria-label` and visible
  string that `e2e/` selects on.
- [ ] **A working indicator that moves.** A `working` dot is a static blue circle today.
  Use a small pulse or spinner (zeron's is a 750ms phase wave), and a slow breathe for
  needs you. Static under `prefers-reduced-motion`.
- [ ] **Group headers like zeron's:** a folder glyph, the repo name in the text color
  (not muted), then the count, with the chevron and "+" right-aligned and shown on
  hover.
- Two items above get their look in this pass but stay decided where they are. One is
  *A terminal-tab row looks like the session you want*, which the restyle mustn't
  settle by accident. The other is *Unseen markers*, drawn as a small dot beside the
  time, as zeron draws it.

**Motion (CSS only)**
- [ ] **One motion catalog, in CSS variables.** It comes from zeron's inventory: popover
  `menu-in` 140ms scale .96 → 1 and translateY −2; dialog-in 180ms; fade-in 500ms
  `cubic-bezier(0.16,1,0.3,1)`; fade-quick 150ms; 200ms ease-out for size changes.
  Apply it to the row menu, the PR menu, the remove confirm and the new-session box.
  Respect reduced motion.
- [ ] **Frosted popovers.** The row menu, the PR menu and the new-session box get a
  `backdrop-filter` blur, a hairline border and a soft shadow. Zeron puts every float
  on one frosted surface.

**Window chrome (Tauri config plus a header component)**
- [ ] **A unified title bar.** Use `titleBarStyle: "Overlay"` with a hidden title, so
  the traffic lights sit inset over the sidebar, as in zeron. The pane gets a 44px
  header: the session's name, then `repo` muted, state, and PR chip, with
  `data-tauri-drag-region` on the empty space. Decide first: how this header relates to
  the bottom `pane-status` bar.
- [ ] **Sidebar vibrancy.** Use a native macOS material behind the sidebar only, while
  the terminal stays opaque. It needs a transparent window, so it costs
  `macOSPrivateApi`. Decide first: whether that trade is worth it. Text contrast must
  hold over any wallpaper (zeron thickens the tint until it does).
- [ ] **A collapsible, resizable sidebar.** 208–400px, default 256, persisted, with
  200ms width easing. Double-click the edge to reset. A shortcut toggles it. This
  overlaps *Keyboard switching* above, so pick the keys once.

**New surfaces (each a slice, and each wants its own acceptance criteria)**
- [ ] **A new-session canvas in the main area**, in place of the box under the group.
  It's a composer pill (prompt, mode, repo picker defaulting to the group clicked) on an
  empty pane. Zeron's empty state *is* this canvas. This is the same flow as
  `NewSessionBox.tsx`, laid out differently.
- [ ] **An empty pane that isn't blank.** With nothing selected, show the canvas (above)
  or a quiet mark and the shortcuts, not `pane-empty`'s one line.
- [ ] **A Cmd+K palette** over the sidebar's own rows: jump to a session by name or
  repo, plus New session, Add repo and Stop. Zeron's palette reuses the sidebar rows.
- [ ] **A repo avatar on group headers** (the GitHub owner image). Decide first: it's
  the app's first network fetch that isn't a PR link the user clicked.

## Undecided — needs a decision before it's work

Nothing open. (Clipped's e2e discipline was decided on 2026-09-26: ported, with the
gate on merge instead of push. See `NOTES.md` → *Chapter 2 closed*.)

## Shipped

- 2026-10-01: chapter 4, slice 2: the PR link.
  - `pr_links.rs` reads `children[kind=pr]` from each job's `state.json`, and any miss
    means no chip.
  - A row shows its newest PR as `#N`, then `+k`, whose menu lists the rest.
  - `open_pr` opens only an `https://` link a listed session names.
  - Items 11–15 pass under `npm run e2e`, item 16 under `cargo test`, and all eight
    breaks turned red. Item 17 (by hand, release app) passed. **Chapter 4 and MVP 1
    close.** The results are in `NOTES.md`.
- 2026-10-01: chapter 4, slice 1: notifications and the Dock badge.
  - Our own `UNUserNotificationCenter` delegate posts on transitions into needs you,
    done or failed. Launch is the baseline, and the selected session is quiet while the
    window is key.
  - A tap opens the session as a row click does. The Dock badge counts needs you.
  - Items 1–9 pass under `npm run e2e`, and all 12 breaks turned red. Item 10 passed by
    hand in the release app. The results are in `NOTES.md`.
- 2026-09-30: chapter 3, slice 4: Stop and Remove. A background row's context menu
  offers Stop while live and Remove always. Only Remove confirms. Either one runs only
  after the row's attach has been reaped, and an `rm` refusal is shown verbatim. Items
  18–21 pass under `npm run e2e`, and all 14 breaks turned red. Item 22 (by hand, release
  app) passed after the merge. The results are in `NOTES.md`.
- 2026-09-28: chapter 3, slice 3: the trust pane. `--bg`'s `Workspace not trusted` opens
  an interactive `claude` in that repo, which the app never signals, and its exit makes
  the box retry once. Quit and window close are refused while it runs. Items 13–16 pass
  under `npm run e2e`, and item 17 (by hand, release app) passed after the merge. The
  results are in `NOTES.md`.
- 2026-09-28: chapter 3, slice 2: a new session from the app. "+" on a repo group runs
  `claude --bg` with the prompt and mode, then selects and attaches the new session.
  "Add repo…" and "Remove from list" keep the app's own `repos.json`. Items 5–11 pass
  under `npm run e2e`, each claim proved red by a break. Item 12 (by hand, release app)
  passed after the merge. The results are in `NOTES.md`.
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
