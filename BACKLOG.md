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

## Next — chapter 5, the UI pass (beside MVP 2)

Opened 2026-10-04 with `/decide`. The decisions, what was rejected, and the acceptance
criteria are in `PLAN-ui-pass.md`. The backlog this came from is in `NOTES.md` → *The
UI pass, from zeron*. It runs while daily use and MVP 2's `/decide` carry on.

- [x] **1. Look.** Shipped 2026-10-04 (below). Light and dark tokens that follow
  macOS, Geist and JetBrains Mono bundled, the terminal's theme in both modes, and thin
  scrollbars with edge fades. Items 1 and 3 passed by hand the same day, after a fix:
  the terminal is opaque until slice 2 (`NOTES.md`, *Slice 1's hand items*).
- [ ] **2. Chrome.** Liquid Glass through our own objc2 module, the overlay title bar
  and the pane header, and sidebar collapse and resize. **The spike is in**
  (`slice2-chrome`): the glass composes, and the fallback works. A see-through terminal
  fails on WebGL in light mode. **The terminal is decided:** DOM behind a speed gate,
  else opaque (`PLAN-ui-pass.md`, criteria 23–27).
- [ ] **3. Rows.** Two-line rows, the moving indicator, the time from `updatedAt`, and
  group headers with GitHub avatars.
- [ ] **4. Motion.** One motion catalog, and frosted popovers.
- [ ] **5. Surfaces.** The new-session canvas, the ⌘K palette, and the keymap, which
  takes over *Keyboard switching*.

## Later — MVP 2

- [x] **Try giving `claude --bg` jobs window control, once.** It works (2026-10-04).
  macOS attributes a job to the app hosting its attach, so the grants go to
  **Oscillate.app** (Accessibility, Screen & System Audio Recording), not `claude.exe`.
  `drive-window`, `screencapture` and System Events' appearance switch all work from a
  job attached in the installed app.
- [ ] **Claude's own grays in dark mode.** The author's Claude Code theme is `light`, so
  Claude sends colors meant for a light background. In Oscillate's dark mode its
  muted and dim text sits at about 1.7–1.9:1. It isn't the palette. Try one of
  `/theme`'s ANSI-only variants, which draw with the terminal's 16 colors and so follow
  both palettes. That's the author's setting to change; the app never edits it.
- [ ] **The reload test flakes in full runs** (2026-10-04: the two reload specs, run alone,
  failed 2 of 5 on `main` and 2 of 5 on chapter 5's slice 1, `PLAN-ui-pass.md`) (`sidebar-order.spec.ts`, item 4, and now
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

- [ ] **A themes tab** in a settings surface, with well-known themes (zeron ships
  Gruvbox, Catppuccin, Tokyo Night, Nord and others). It includes terminal opacity.
  Chapter 5's tokens are semantic roles so a whole variant can be swapped in
  (`PLAN-ui-pass.md`).

## Undecided — needs a decision before it's work

Nothing open. (Clipped's e2e discipline was decided on 2026-09-26: ported, with the
gate on merge instead of push. See `NOTES.md` → *Chapter 2 closed*.)

## Shipped

- 2026-10-04: slice 1's hand items, and the fix they found.
  - xterm read none of our `rgb(r g b / a%)` colors, and kept its opaque black. The
    terminal theme now writes hex, and `check-theme` fails any color xterm can't parse.
  - The terminal is opaque (`TERMINAL_ALPHA = 1`), because translucent WebGL drew dim
    text at about 7%. The host's padding is painted in the terminal's color.
- 2026-10-04: chapter 5, slice 1: the look.
  - `src/palette.ts` names every color: light and dark chrome roles, and the
    terminal's full theme at 80% alpha. Both follow macOS live.
  - Geist and the complete JetBrains Mono are bundled.
  - The sidebar has a thin scrollbar and edge fades.
  - Item 2 passes under `.claude/scripts/check-theme`, which breaks turned red. Items 4
    and 5 pass under `npm run e2e`.
  - Items 1 and 3, the light and dark looks by hand, are open.
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
