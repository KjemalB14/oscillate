# Oscillate — working notes

Running log across sessions. `CLAUDE.md` is the authoritative *state*; `BACKLOG.md` is
what is not built yet. This file is for everything else: what was tried, what was
decided and why (including what was rejected), what a thing cost to find out, and
workflows worth repeating.

Newest entries at the top.

---

## 2026-10-01 — Chapter 4, slice 2: the PR link

Items 11–15 pass under `npm run e2e` (`e2e/pr-links.spec.ts`, by `e2e-author`), and item
16 passes under `cargo test`. Each claim was proved red by a break. Item 17, by hand in
the release app, is still open.

### What was built

- **`pr_links.rs`:**
  - It reads `jobs/<id>/state.json` for every listed id on each poll. Each file is about
    3 KB, and the poll already runs every 2s.
  - It keeps `children[]` entries with `kind: "pr"`, a string or number `id`, and an
    `https://` href. They're kept oldest first, so the newest is the last.
  - The poller attaches them after `FirstSeen`. A PR that appears or goes is a list
    change, so `sessions-changed` carries it, and the watch on `jobs/*/state.json`
    re-polls at once.
- **Misses** are no file, unreadable, not JSON, no `children`, and a bad PR child. Each
  logs one line per session and kind of miss, once for the life of the app. A
  `children[]` with no PR entries isn't a miss: most sessions have none.
- **`open_pr` opens only what a listed session names.** It checks the href against the
  last snapshot's PRs, as well as the `https://` prefix. So the page can't ask Rust to
  open an arbitrary URL.
  - **Rejected:** opening from the page through the opener plugin's JS API. That would
    have worked, but the e2e build couldn't intercept it without a second hook.
- **`FloatingMenu`** is the row context menu's positioning and dismissal, factored out.
  The `+k` menu uses it too. **Rejected:** a second copy of the same effects in a new
  menu component.
- **Invariant 5** now names the exception (`CLAUDE.md`).

### Breaks, and what they turned red

| Break | Red |
|---|---|
| P1 the oldest PR as the chip | 11, plus knock-ons in 13 and 15 |
| P2 the `+k` menu oldest first | 11 (menu order) |
| P3 `+k` counts the chip too | 11, 12 |
| P4 `http://` hrefs accepted | 13 (non-https) |
| P5b a miss on one row hides every row's chips | 13 (all six cases) |
| P6 PRs read only at launch | all 12 |
| P7 the app writes into a job dir | 15 |
| P8 every menu item opens the newest | 11 (each item's own href) |

- **The first P5 stayed green, and the break was at fault.** It skipped one poll on a new
  miss, and the next poll recovered within the spec's 3s windows. P5b is persistent,
  and it's the break that counts.
- **P4 also turned item 11's "within 3s" red,** though that break doesn't touch it.
  Probably a knock-on from the failing case before it. Watch item 11 for flakes.
- **The full suite's first run failed item 3 of slice 1** (`notifications.spec.ts`) on
  a 30s timeout. That test does a `browser.refresh()`, the same reload hang as the
  backlog's flaky `sidebar-order` item 4. The re-run was green (86 of 86) and was the
  one recorded for the merge. The flake is in the same backlog item.
- **The spec lock refused a command that only named the spec's path,** in a heredoc
  that wrote this job's own break runner. The runner was then written with the file
  tools. The lock matches on the command's text, so naming a spec path anywhere in a
  write counts as touching it.
- **Breaks run about 30 minutes each when the spec fails.** Each failed test waits out
  its timeouts. A laptop sleep paused the runner mid-break, and it resumed.

### Not proved yet

- **Item 17 (by hand, release app).** A real session's newest PR as `#N` with `+k`, and
  `#N` opening the browser.
- **That `children[]` is in creation order** (`PLAN-notifications.md`, *Still open*).

---

## 2026-10-01 — A GitHub remote

`main` is now pushed to github.com/KjemalB14/oscillate. The repo is **public**, at the
author's choice, and commit author emails are public with it.
- Before the first push, every commit was scanned for tokens (`gh*_`, `sk-ant-`, AWS and
  Slack keys), and none were found.
- **The e2e gate stays on the merge, not the push.** It was put there because there was
  no remote (`NOTES.md`, *Chapter 2 closed*). A merge into `main` is still the moment
  code lands, and pushing `main` afterwards only publishes what already passed. So
  `.claude/e2e-merge-gate.sh` is unchanged, including its comment saying there's no
  remote.
- **Only `main` is pushed.** Working branches (`chN/*`, `docs/*`) stay local.

---

## 2026-10-01 — Chapter 4, item 10 passed by hand

The author clicked, and this job (7787b9c5) checked each step against `claude agents
--json --all` (Claude Code 2.1.286), the app's child processes, and the app's stderr.
The app was the release bundle, installed in `/Applications` and launched from this job
with stderr sent to a file. The throwaways were plan-mode sessions asked to use
AskUserQuestion: `0e031ad4` and `ee570d5b`. Both were `claude rm`'d afterwards.

- **Permission:** asked once at first launch. On this macOS, the request is itself a
  notification ("Notifications may include alerts, sounds, and icon badges"), and
  *Allow* sits under its Options. There's no dialog.
- **Banner and Dock badge from the background:** the throwaway's banner showed, and the
  Dock said 1.
- **A tap, with Oscillate in the background and when minimized:** the window came
  forward with the session attached. The log showed `notification 7787b9c5:
  com.apple.UNNotificationDefaultActionIdentifier (Some(Tap))`, and `claude attach
  7787b9c5` started as the app's child.
- **Quiet while on screen:**
  - `0e031ad4 Done: on screen, not notified` came while its pane was selected and
    Oscillate in front.
  - So did `7787b9c5 input needed: on screen, not notified`.
- **A dismissal:** the banner was posted, closed with ×, and no response arrived. macOS
  sends no dismiss response without a category's custom dismiss action, so nothing
  opened.

Found on the way:
- **The first tap opened nothing,** and stays unexplained. The window came forward, but
  no session was selected and no attach ran. That build logged nothing on a response.
  Every tap after the log lines were added went through the delegate and attached.
  **If it recurs, the log line says whether the delegate was called.**
- **Every question this job asked the author notified for 7787b9c5,** since asking makes
  this session blocked. In Notification Center, Oscillate's stack shows the newest on
  top, so the first tap after the log lines opened this session, not the throwaway.
  **Don't test with questions from the session doing the check:** they decide what
  notifies, and they pull the author's focus out of Oscillate.
- **`is_minimized()` read `false` while the window was minimized.** The outcome is the
  same, since a minimized window is never key. But the logged value can't be trusted.
- **The decision is logged on stderr now:** `<id> <body>: notified (selected …, key …,
  minimized …)` or `on screen, not notified`, plus one line per response. A
  Finder-launched app's stderr goes nowhere. To see it, launch
  `/Applications/Oscillate.app/Contents/MacOS/oscillate 2>log`.

---

## 2026-10-01 — Chapter 4, slice 1: notifications and the Dock badge

Items 1–9 pass under `npm run e2e` (`e2e/notifications.spec.ts`, by `e2e-author`). Each
claim was proved red by a break. Item 10 is by hand in the release app, and still open.

### What was built

- **`attention.rs` decides; `notifications.rs` posts.**
  - The decision is pure: transitions per id, launch as the baseline, the visibility
    rule, the badge count, and the sidebar's group labels.
  - `notifications.rs` has three sinks: `MacSink` in a `.app`, `NoSink` in `tauri
    dev`, and `LogSink` in the e2e build.
- **The objc2 delegate compiled at the first try.** It's a `define_class!` with
  `willPresent` and `didReceive`. `objc2-user-notifications` 0.3.2's default features
  cover every class used. It was already in `Cargo.lock` through tao and wry.
- **The Dock badge is Tauri's `set_badge_count`.** tao 0.35.3 implements it on macOS as
  `NSApp.dockTile.setBadgeLabel` (`platform_impl/macos/badge.rs`). So tauri#13905 isn't
  a code-level problem here, and item 10 is the check.
- **The module is `notifications`, not `notify`.** `notify` is the file-watch crate, and
  a module of that name shadowed it in `lib.rs`.
- **The subtitle is the sidebar's group label.** It's ported from `src/groups.ts` to
  Rust, over the sessions' cwds plus the added repos. `cargo test` mirrors the `beta`
  and deep-collision cases.

### Decisions, and what was rejected

- **Focus is a file in the e2e build** (`OSCILLATE_E2E_FOCUS`, default `key`). Which app
  macOS has in front during a suite run isn't the spec's to control.
  **Rejected:** the real window focus in e2e, which would make item 4 depend on whatever
  the author was doing. The real `is_focused`/`is_minimized` path is item 10's.
- **Taps go through an e2e-only command into the same `respond()` the delegate calls.**
  The command is always registered, and refuses outside the `e2e` feature, so
  `generate_handler!` needs no cfg. **Rejected:** driving a real banner, which needs a
  bundle and Apple Events.
- **The page reports its selection to Rust** (`set_visible_session`), and that call also
  removes the session's delivered notification. A reload starts at `null`.
  **Rejected:** Rust inferring the visible session from which PTY was last written to.
  Panes stay alive while hidden, so that says nothing about what's on screen.

### Breaks, and what they turned red

Each break was applied alone, the spec was run, and the file was restored.

| Break | Red |
|---|---|
| B1 the first list posts (no baseline) | 3, after a fix (below) |
| B2 the visibility rule skipped | 4 |
| B3 a dismissal opens the session | 7 |
| B4 the badge also counts done and failed | 8, after a fix (below) |
| B5 selecting removes nothing | 5, 6 |
| B6 every state change posts | 2 |
| B7 a tap emits nothing | 6 |
| B8 the body drops `waitingFor` | 1 |
| B9 the subtitle is the raw `cwd` | 1 |
| B10 the notifier writes under the Claude dir | 9 |
| B11 the page never reports its selection | 4, 5, 6 |
| B12 a tap on an unlisted id opens it | 6 |

- **B1 first stayed green on item 3.** The spec read `from` after `relaunch()` returned,
  and by then the new app's first poll had already posted. Now the old app reads the
  list first, and `from` is taken before the relaunch.
- **B4 first stayed green on item 8.** Its fixture had only blocked sessions. Now every
  step also lists done, failed, working and terminal-tab entries.

### Not proved yet

- **Item 10 (by hand, release app).** It covers the permission prompt, a real banner, a
  real tap from the background and from minimized, a dismissal, and the Dock tile.
- **A second question while `blocked`.** If no other state shows between two polls,
  it's not a transition, so nothing posts. Watch for it in use.
- **A tap after the app quit.** Whether the delegate is set early enough isn't tested
  (`PLAN-notifications.md`, *Still open*).

---

## 2026-09-30 — Chapter 3 closed: start and end sessions from the app

All four slices shipped, and all 22 items passed: 1–11, 13–16 and 18–21 under
`npm run e2e`, each proved red by a break, and 12, 17 and 22 by hand in the release app.
The app now starts a session in a repo, walks you through workspace trust, and stops and
removes sessions, without leaving the window. `PLAN-new-sessions.md` was deleted with
this entry. Its full text (the question, what was chosen and rejected, the acceptance
criteria) is at commit `9b1a7ce`: `git show 9b1a7ce:PLAN-new-sessions.md`. The code comments and
specs that cite it resolve there, as chapter 2's do. The decisions that outlive the
chapter:

- **Rows keep the `startedAt` the app first saw, for the life of the app process.**
  `startedAt` is the current process's start, so a respawn used to move a row under the
  pointer. **Rejected:** rows by name (Claude renames a new session after its first
  turn), by id (meaningless order), by live `startedAt` (the bug), and by `state.json`'s
  `createdAt` (breaks invariant 2).
- **"+" takes a prompt and a permission mode, and runs `claude --bg` as argv, no shell.**
  **Rejected:** prompt only (plan mode would mean going back to the terminal), and a name
  field (Claude names sessions itself).
- **Only added repos outlive their sessions,** in the app's own `repos.json`, with
  "Remove from list". **Rejected:** remembering every repo ever seen (old experiments
  pile up), and no way to leave the list.
- **Trust: the author accepts in an interactive `claude` the app never signals, and its
  exit triggers exactly one retry.** **Rejected:** polling `--bg` and killing the pane on
  success (a kill on an inference, at a trust prompt), reading the REPL's output (breaks
  across versions), and running the prompt in the trust `claude` (breaks invariant 1).
- **Stop and Remove wait for the attach's reap in Rust, and only Remove confirms.**
  **Rejected:** confirming both (Stop is undone by an attach), confirming neither (a
  clean `rm` deletes with no refusal), and any button that passes `--discard-unpushed`.
- **Hand checks can't come from a `claude --bg` job's hands.** Three of them (items 12,
  17, 22) needed Apple Events. The pattern that worked: the author clicks, and the job
  checks every step against `claude agents --json --all` and the app's child processes.

What the chapter left unproved:
- **The reload test flakes** in full runs (`BACKLOG.md` → *Later*).
- **Dock → Quit and logout during a trust pane** still end the app (`BACKLOG.md`).
- **An added repo whose folder is gone** stays a group with a "+", and item 17's temp
  repo is one (`BACKLOG.md`).
- **`/exit` in the trust pane gives no sign it was taken** (`BACKLOG.md`).
- No spec covers the trust pane's reload rebind or a keyboard-opened row menu. How fast a
  real `claude attach` exits on a hangup is modelled (600ms), not measured. `rm`'s
  `--force-remove-worktree` refusal was never produced. The permission mode was never
  seen in a real daemon's process args.

---

## 2026-09-30 — Chapter 3, item 22 passed

Run from a `claude --bg` job again (7787b9c5), so `drive-window` still failed with
`-1743`. The author was at the laptop and clicked; this session checked each step
against `claude agents --json --all` (Claude Code 2.1.286) and the installed app's child
processes (`pgrep -P <app pid>`). The app was the slice-4 build in `/Applications`, not
rebuilt.

- **Start.** "+" with mode `plan` and "Read every file in src-tauri/src and summarize
  each one". The daemon listed `04d29813` ("summarize tauri src files"), `working`, and
  the app's only child was `claude attach 04d29813`.
  - **It started in the wrong group.** Its `cwd` was `tmp.ergPPXxr2Q`, the temp repo from
    item 17's hand check (2026-09-28), which is still an added repo in the installed
    app's `repos.json`. Its group sorts right after `oscillate`. That didn't matter for
    item 22: any real throwaway session from the app will do. The session found no
    `src-tauri/src` and asked a question, so it was `blocked` (needs you) at Stop time,
    which still counts as live.
- **Stop.** Right-click → Stop. The daemon listed `04d29813` as `stopped`, no process
  named it, and the app had no attach child. The row showed the solid grey stopped dot,
  and the pane said "Detached — click to reattach".
- **Remove.** Right-click → Remove → confirm. The row went, and `04d29813` was gone from
  `agents --json --all`. The other four sessions were unchanged throughout.
- **Not checked:** the exact `stop`/`rm` argv the app ran. The e2e fake pins it (items
  19–21), and real `claude` doesn't log it.

---

## 2026-09-30 — zeron, a reference project

The author found [zeronsh/zeron](https://github.com/zeronsh/zeron) (MIT, Rust, ~2.5k stars,
active as of 2026-09-30). It's "a native control plane for Claude Code, Codex, Cursor,
Devin and other coding agents", and the author wants it to inform features and, later, UI.
It changes nothing now, and chapter 3 continues as planned. This is from its README and
`ARCHITECTURE.md` only, with none of its code read.

**Where it matches Oscillate:** one native window, a sidebar of sessions across folders, a
click that opens one, and new sessions started from the app. Its screenshot shows a Claude
Code session with a live branch-diff sidebar.

**Where it differs, and why the architecture isn't borrowed:**
- **It owns the sessions.** Its own Rust engine daemon "runs agents, owns … terminals,
  repos/worktrees", and it keeps transcripts in its own Loro CRDT docs. Oscillate is a thin
  client over Claude Code's own daemon (invariant 1). Borrowing its engine would reverse
  the first locked decision, so it's a reference for *what* to offer, not *how* to run it.
- **Multi-agent and multi-device.** Codex, Cursor, Devin and others, plus optional sync
  through Cloudflare Durable Objects. Neither is in Oscillate's scope.
- **UI toolkit:** gpui (Zed's), against Oscillate's Tauri + xterm.js (locked).

**Worth mining when a chapter opens** (unverified until someone reads its code or runs it):
- An **attention-sorted** sessions list: relevant to chapter 4 (*It tells you when it needs
  you*), and in tension with chapter 3's frozen row order. That tension is `/decide`'s
  to weigh.
- A **spaces** filter: a searchable dropdown of (device, folder) pairs, "All spaces"
  included, which also hosts space management. Compare with our repo groups and "Add repo…".
- **Tabs as a local viewport** onto the list. Closing a tab only hides it, archiving is an
  explicit sidebar action, and a sidebar click reopens. Compare with our pool of 6 panes.
- A **new-session canvas** with a space picker that defaults to the current filter, else the
  last space. Compare with our "+" box.
- **Unseen markers** and resort animations on the sidebar.
- A **branch-diff sidebar** beside the running session.
- In-app update flow ("Update ready — restart to apply").

---

## 2026-09-30 — Chapter 3, item 22: installed, not yet checked

- **The slice-4 release app is installed.** The bundle built from 7ccc38b (09:40, after
  the merge) replaced slice 3's in `/Applications`. The author approved quitting the running
  app, `codesign -v` passed, and the app relaunched.
- **Item 22 didn't run.** This session was a `claude --bg` job again, so `drive-window`
  failed with `Not authorized to send Apple events to System Events (-1743)`. The author was
  remote and couldn't drive it either. No throwaway session was created: the daemon's list
  was the same before and after.
- **`osascript … to quit` did quit the app, but still exited 1.** Quitting the old app from
  a `--bg` job works. Anything that needs System Events doesn't.
- **What the check needs:** an interactive session at the laptop, or the author. A plan-mode
  "Reply ok" session is `done` in seconds, and Stop is only offered on live rows. So the
  throwaway needs a prompt that keeps it working, e.g. "Read every file in src-tauri/src
  and summarize each one". **Never Stop the row of the session doing the check.**

---

## 2026-09-30 — Chapter 3, slice 4: Stop and Remove

### What real `stop` and `rm` print (the PLAN's "real rm refusal text")

Captured against Claude Code 2.1.285, with throwaway plan-mode sessions ("Reply with the
single word ok"), which were then removed.
- **A new `mktemp -d` repo can't host one.** `--bg` there says `Workspace not trusted`,
  and trust may only be answered "No, exit". So the probe ran `claude --bg --worktree
  rmprobe` in this repo, which is trusted and ignores `.claude/worktrees/`
  (`.git/info/exclude`). One empty commit in that worktree gave it something unpushed.
- **`rm` refused with exit 1, on stdout, with empty stderr.** The text is in
  `src-tauri/fixtures/end/rm-refused-2.1.285.txt` and `e2e/fixtures/rm-refused-stdout.txt`.
  It said "63 unpushed commits", because this repo has no remote, and it ended with the
  full `claude rm <id> --discard-unpushed <commit>@<worktree-id>` command.
- **The cleanup didn't use that flag.** `git worktree unlock` and `remove --force`, then
  `git branch -D worktree-rmprobe`, then a plain `claude rm`, which printed `removed <id>`
  plus the worktree's path.
- **`stop` prints `stopped <id>`, exit 0.** A live session (`working`/`busy`) is then
  listed as `stopped`, with no `status` or `pid`. A session already `done` stays `done`.
  So Stop on only live rows matches the daemon.
- `stop` and `rm` of an unknown id, run in an untrusted directory, fail with `No job
  matching '<id>'`, not a trust error. The app runs them in the session's `cwd` when it
  still exists, else `$HOME`.

### What was built

- The command is `end_session(id, end)` in `lib.rs`, and `endsession.rs` holds the argv:
  exactly `stop <id>` or `rm <id>`, with the id checked to be letters and digits.
- `pty::end_attaches` closes the session's attach and waits on `reaped` until its child
  is gone, 5s at most (the watch SIGKILLs at 2s).
  - It returns a guard. While the guard is held, `admit` refuses a new attach to that
    session, so a click during `stop` can't put an attach beside it.
  - `admit` checks the set under the `live` lock, and `end_attaches` marks the set before
    taking that lock. So a racing attach is either refused, or already in `live` and
    closed there.
- The one-shot spawn, timeout and "stderr, then stdout" code moved from `newsession.rs`
  to `claude::run_once` / `Ran::shown`, shared by `--bg`, `stop` and `rm`.
- `src/rowActions.ts` holds each row's confirm, running and failed state.
  - `Sidebar.tsx` shows the menu (`role="menu"`) where the pointer is, kept inside the
    window, and under the row when opened from the keyboard.
  - Remove's one-line confirm and a failure's verbatim `<pre>` sit under the row. A
    running row's detail says "Stopping…" or "Removing…".
- Every row suppresses WKWebView's own context menu (Reload, in a release build).
  Terminal-tab rows open nothing.

### Decisions, and what was rejected

- **Rust waits for the reap, not the page.** The page only knows that its PTY's exit
  event fired. Rust knows the child was reaped, and it can refuse a reattach meanwhile.
  **Rejected:** closing the pane in React, then invoking `stop` from its exit callback.
  A reattach click could slip in between, and the page can't tell that apart.
- **The refusal shows under its row, not in the main area.** It's about that row, and
  the pane beside it may belong to another session. It's a `<pre>`, selectable, wrapped,
  and scrolls past 220px. It stays until dismissed or until the next action on the row.
- **Stop isn't offered on `unknown` rows.** The PLAN names working, needs you and paused
  as live, and an unknown state might be finished.
- **`rightClick()` is harness code that sends WebKit's `mousedown`, `contextmenu`,
  `mouseup`.** This embedded driver's `click({ button: "right" })` sends only the mouse
  events, so no `contextmenu` ever fires. Its keys are page-dispatched events too
  (`press()`), so this is the same kind of stand-in. **Rejected:** a visible "…" button
  per row as the tested path. The PLAN chose a context menu, and a button would test a
  path the author doesn't take.

### Verified

- `cargo test`: 40 passed, 7 full runs out of 7 with exit 0 (3 before the specs, 4
  before the merge).
- **Items 18–21** pass under `npm run e2e`, in `e2e/stop-remove.spec.ts` by `e2e-author`,
  7 tests.
- **Breaks,** 14, each applied, run and reverted by a scratch script. Each turned red the
  claims named:
  - Stop on every row turned 18 red (two tests). A menu on terminal-tab rows turned
    18's terminal-tab claim red.
  - No drain turned 19 and 20's confirm red. A second `stop` turned 19, 20 and 21 red.
    A guard that never drops (no reattach) turned 19 red.
  - Remove without a confirm turned 20 and 21 red. A Cancel that hangs up every PTY
    turned 20's cancel claim red.
  - An extra `--yes` on `rm`, and an extra `--force-remove-worktree`, each turned 20
    and 21 red.
  - The first line of the refusal only, a non-selectable refusal, a second `rm` 1.5s
    later, and a row hidden while the refusal shows, each turned 21 red.
  - A drain that hangs up but doesn't wait for the reap turned 19 and 20 red.
- **Two breaks stayed green at first.**
  - **The no-wait drain.** The fake attach died within ~50ms of its hangup, which is
    faster than the app starts the next `claude`, so the race never showed. The fake now
    has `lingerOnHangup(ms)`, and items 19–20 run with 600ms.
  - **The hidden row.** At first the break set `hidden` on the row, which `.session`'s
    `display: grid` overrides, so the break did nothing. With `display: none`, it stayed
    green because the spec checked the row existed, not that it showed. `e2e-author`
    changed it to `toBeDisplayed()`.
- Item 21's whole-run claim is checked at the end of `stop-remove.spec.ts` over
  `fake.argvs()`, so it covers the specs that run before it, and itself. The argv is
  also pinned in Rust (`argv_is_the_verb_and_the_id_only`).

### The reload test flaked again

`sidebar-order.spec.ts`'s reload test is the one slice 3 saw time out. It timed out at
mocha's 30s in **2 of 8 full runs of this branch**. Its own waits give up at 10s and 5s,
so a WebDriver `execute` hung across the reload.
- **`main` (45b575e) passed 4 of 4.**
- **This branch with only the fake attach's old blocking read put back passed 4 of 4 on
  that test.** Its items 19–20 failed by design, since that read logs no exits.
- The two failures were the 1st and 4th of the first four runs, and the next four all
  passed.
- 2 of 8 against 0 of 8 doesn't pin a cause. The one suspect is the attach's new 50ms
  `select` loop. It's the only change that runs during the specs before this one, but
  it makes no request of the page, and slice 3 saw 2 of 5 on a tree without it.
- **Merged anyway, with this recorded.** The failing test can't be edited here (it's
  `e2e-author`'s), and the gate needs a green run of the exact tree, which it got.
  `BACKLOG.md` → *Later* has the follow-up.

### Harness defects found on the way

- **The embedded driver's right-click sends no `contextmenu`** (above). `harness.check.ts`
  now proves `rightClick()` delivers all three events.
- **`script(1)` can't give a child a terminal under WDIO**, whose stdin is a socket
  (`tcgetattr/ioctl: Operation not supported on socket`). The attach-exit check goes
  through the app's own PTY instead.
- The fake attach's read loop is now the 50ms `select` loop `trust.pl` has, so its signal
  handlers run and a hangup is logged as `attach-exit`.

### Not verified

- **Item 22, by hand.** This slice was built in a `claude --bg` job, which can't send
  Apple Events, so `drive-window` couldn't run.
- **How fast a real `claude attach` exits on a hangup.** The 600ms linger is a model, not
  a measurement. The 5s bound on the wait is only a guard.
- **`rm`'s other refusal**, the one that names `--force-remove-worktree`, wasn't
  produced. It's shown the same way, since only the exit code matters.
- **A keyboard-opened menu** (the context-menu key) has no spec.

---

## 2026-09-28 — Chapter 3, slice 3: the trust pane

### What an untrusted `--bg` prints

`claude --bg --permission-mode plan "Reply with ok"` ran in a new `mktemp -d` git repo,
with stdin closed (Claude Code 2.1.284). It **exited 1, with empty stdout**, and printed
one line on stderr:

```
Workspace not trusted. Run `claude` in <canonical dir> once and accept the trust prompt, then retry.
```

No session was listed for that directory. The bytes are pinned twice: in
`src-tauri/fixtures/bg/untrusted-2.1.284.txt` for the Rust test, and in
`e2e/fixtures/bg-untrusted-stderr.txt`, which the fake answers with, naming its own cwd.
The app treats stderr that starts with `Workspace not trusted` as the trust error.

### What was built

- `newsession::start` returns `StartError { untrusted, message }`.
- The box calls `onUntrusted`. The app then opens `TrustPane.tsx`, which runs
  `trust_open`: interactive `claude`, no arguments, in that `cwd`.
- When the pane's process exits, the box reopens with the prompt and mode it kept, and
  starts once by itself. A second trust error shows "Not trusted, nothing started".
- `pty.rs` holds the trust PTY in the same map as attaches, as `Kind::Trust(TrustInfo)`.
  **`Pty::close_with` returns early for it**, and every kill path goes through that
  function: pane close, the pool, `close_unlisted`, `kill_all` on reload and exit. The
  ← watch skips it outright.
- `xterm` construction moved to `src/terminal.ts`, so both panes share one configuration.

### Decisions, and what was rejected

- **Quit is the app's own menu item.** The stock macOS Quit sends `terminate:`, and
  tao 0.35.3 implements no `applicationShouldTerminate:`, so it ends the process without
  asking, and nothing can refuse it.
  - The replacement item keeps `CmdOrCtrl+Q` and calls the `quit` command. That command
    refuses while a trust PTY lives, and emits `quit-refused` to the page.
  - The page also handles Cmd+Q itself, because a key dispatched in the page (e2e's
    `press("Cmd+Q")`) never reaches a menu accelerator. Both paths call the same
    command.
  - Window close (`CloseRequested`) and `ExitRequested` are refused the same way.
  - **Rejected:** an item with no accelerator, so that the real key reaches the page and
    e2e tests the path a user takes. If WKWebView doesn't deliver Cmd+Q to the page,
    Cmd+Q would stop quitting at all, and a `--bg` job can't press a real key to find
    out.
  - **Rejected:** adding `applicationShouldTerminate:` to tao's delegate at runtime. It
    would cover Dock → Quit too, but it patches another crate's class.
- **Rust keeps the trust pane across a reload.** WKWebView's right-click menu offers
  Reload in a release build.
  - A page-only trust state would orphan a `claude` the app may never kill, with quit
    refused for good.
  - So `TrustInfo` (cwd, label, prompt, mode) lives with the PTY. On load the page asks
    `trust_current`, and `trust_open` for the same `cwd` rebinds the output and exit
    channels instead of spawning. Its sender keeps going when a send fails; an
    attach's still stops.
  - **Rejected:** Rust doing the retry itself, so it also survives a reload. That puts
    the box's whole flow in two places.
- **"+" anywhere, while a trust pane is open, shows that pane and spawns nothing.**
  Item 16 says "a second '+' on an untrusted repo". The only repo the app knows is
  untrusted is the pane's own, and finding out about another would take a `--bg`.
  **Rejected:** "+" on other repos working as usual, which fails the stricter reading.
- **The pane takes focus on every request** (the sidebar entry, "+", a refused quit),
  not only when it becomes visible. `e2e-author`'s first run found "+" left focus on
  the button, because Cmd+Q had already shown the pane.

### Verified

- `cargo test`: 37 passed, including the real trust error being classed as untrusted.
- **Items 13–16** pass under `npm run e2e`, in `e2e/trust-pane.spec.ts` by
  `e2e-author`. The whole suite has 58 passed, and the green is recorded.
- **Breaks,** each applied, run and reverted by a scratch script. Each turned red
  exactly the claims named:
  - The trust `claude` given the prompt as an argument turned 13–16 red.
  - The trust error shown as a plain failure, with no pane, turned 13–16 red.
  - No retry on exit turned 14 and 15 red.
  - A retry that drops the mode turned 14 red.
  - A second `--bg` 1.5s after the retry turned 14 and 15 red.
  - A second trust error that reopens the pane 2s later turned 14 and 15 red.
  - The raw stderr instead of "Not trusted, nothing started" turned 15 red.
  - Cmd+Q refused with no message turned 16 red.
  - "+" opening the box while the pane is open turned 16 red.
  - Focus only when the pane becomes visible turned 16 red.
  - **The trust PTY closed as "unlisted" on a list change stayed green at first.** Item
    16 showed every session before the pane opened, so the list never changed while it
    was open, and the app only reacts to a changed list. In real use the list changes
    all the time. `e2e-author` now lists the others after the pane opens, then changes
    and removes one. The break turns 16 red on "pid alive".

### Harness defects found on the way

- **Perl never ran the trust fake's signal handlers.** Perl defers a handler to a safe
  point between ops, and macOS restarts a `sysread` that a signal interrupted, so a
  blocked read never reaches one. `trust.pl` reads through a 50ms `select` loop instead.
  `tty.pl`'s attach loop has the same shape, but it logs no signals, so it was left.
- **`press("/")` sent keyCode 47,** which xterm.js drops. `press()` now maps `/ . , -`
  to their key codes.
- **The reload test flaked, probably because of this slice.** `sidebar-order.spec.ts`'s
  reload test timed out (30s) in 2 full runs out of 5. It always passed alone.
  - To survive a reload, the PTY sender had been changed to keep sending after a failed
    send, where it used to stop. The attach PTYs went back to stopping, and only the
    trust PTY, which is rebound, keeps going.
  - After that, 3 full runs out of 3 passed. That doesn't prove the cause (nothing
    checked main), but it's the only change here that touches a reload's traffic.

- **The first trust-error test made `cargo test` flaky.** It ran a fake `--bg` that
  `cat`ted the fixture to stderr. With it, full runs failed 3 times out of 8, always in
  a timing test (`a_failed_poll_waits_the_retry_interval`, then two `watch` tests once
  the spawning tests shared `serial()`). The commit before the slice had 9 out of 9
  green, and so did this tree with that one test skipped (5 out of 5).
  - The mechanism wasn't pinned down. The likeliest one is a script written while
    another thread forks, which then fails to exec (`ETXTBSY`).
  - The test now checks `is_untrusted` against the real bytes with no process, and the
    existing failure test checks the flag through a real spawn. That gave 6 out of 6
    green.
  - **This was caught after the merge.** The merge command didn't stop on the failed
    `cargo test`, so the fix went in on its own branch.

### Item 17, by hand, after the merge

`/Applications/Oscillate.app` was rebuilt from `19e873d` and reinstalled. The author
drove it in a new `mktemp -d` git repo, added with "Add repo…" (Claude Code 2.1.284).
- **"No, exit" passed.** "+" in plan mode opened the pane labelled "Accept trust,
  then /exit". Cmd+Q, pressed with the real key, showed "Answer the trust prompt
  first", and the app stayed open. So the menu accelerator path works too. After "No,
  exit", the box showed "Not trusted, nothing started" with the prompt kept. `agents
  --json --all` listed nothing for that directory, and `~/.claude.json` had no entry
  for it.
- **The accepted branch passed**, but it took two tries.
  - **The first report was wrong.** The author answered "started and attached" before
    doing it, and the listing, the jobs directory and `~/.claude.json` all showed
    nothing. Checking the disk before recording caught it.
  - **The second try:** Start in the kept box, then "Yes, proceed", then `/exit`. The
    retry started `92684206` in that `cwd`, and trust was recorded for it. The row was
    selected and its pane attached.
  - The pane then showed "Detached". The session's own transcript ends in `❯ /exit`,
    typed after it had answered. The author had typed `/exit` a second time, because
    the first "didn't seem to take", and by then the keyboard belonged to the new
    session. A PTY attach from a script stayed attached for 8s, so `claude attach`
    doesn't leave by itself. `claude rm` removed the session.
  - **A usability gap:** between `/exit` and the new pane, the author saw nothing that
    said it had worked. The likely cause is the trust `claude`'s own exit, which leaves
    its pane unchanged for a moment; the retry box's "Starting…" comes after that. This
    wasn't timed, and it's in `BACKLOG.md`.

### Not verified
- **Dock → Quit and logout still end the app** while a trust pane is open, since
  they send `terminate:`. The trust `claude` then gets the kernel's hangup.
- **The reload rebind** has no spec. After a rebind, the pane stays blank until
  `claude` repaints, and a trust exit during the reload itself loses the retry.

---

## 2026-09-28 — Chapter 3, slice 2: a new session from the app

### What `claude --bg` prints (the PLAN's first "Still open")

One throwaway session was run and then removed: `claude --bg --permission-mode plan
"Reply with the single word ok…"` in this repo, with stdin closed, as the app runs it
(Claude Code 2.1.284). It exited 0 with empty stderr. Stdout:

```
backgrounded · ESC[36mc59cf1b2ESC[39m
ESC[2m  claude agents             list sessions ESC[22m
ESC[2m  claude attach c59cf1b2    open in this terminal ESC[22m
…logs, stop
```

It's **colored even into a pipe.** `agents --json` listed `c59cf1b2` with this `cwd`
at once, and `claude rm` removed it. The bytes are pinned twice: in
`src-tauri/fixtures/bg/2.1.284.txt` for the parse test, and in
`e2e/fixtures/bg-stdout.txt`, which is the fake's default answer. The parse strips CSI
sequences and takes the word after the first line's `·`. The fallback is the word after
`claude attach`. Either must be letters and digits, as `pty_spawn` requires.

### What was built

- `newsession.rs` runs `--bg [--permission-mode <m>] <prompt>` as argv in the group's
  `cwd`, through the resolver, with `child_env`, stdin null and a 30s hang guard.
  `bypassPermissions` is refused in Rust as well as missing from the UI. A non-zero
  exit returns stderr then stdout, verbatim. On success, a clone of the watch's trigger
  `Sender` (`SessionModel.poll_now`) forces a poll.
- `repos.rs` keeps `repos.json` in the app data dir (`OSCILLATE_DATA_DIR` in e2e),
  canonicalized and written by temp file plus rename. The folder picker is
  `tauri-plugin-dialog`, called from Rust only, so there's no JS permission.
- `NewSessionBox.tsx` waits for the id in the session list, then selects it through
  the pool (`select`). After 10s it names the id instead. Start is disabled while a
  start is in flight, so a double click can't spawn two.
- `groups.ts` seeds the grouping map with added repos, so an added repo and its
  sessions' `cwd` are one key.

### Decisions, and what was rejected

- **The mode picker is radios, not a `<select>`.** Under the embedded WebDriver,
  neither `selectByVisibleText`, `selectByIndex`, nor a click on an `<option>` changes a
  select's value. Rejected: a harness helper that sets the value and dispatches
  `change`. The spec would then test a synthetic path that no user takes. Radios are one
  click for the user too.
- **The folder picker's test hook is a file read by Rust, compiled in only with the
  `e2e` feature** (`OSCILLATE_E2E_PICK`). Rejected: a `window.__pick` hook in the
  frontend, which would ship in release JS; and mocking the dialog plugin's IPC, which is
  more of the plugin's internals than the hook needs.
- **`relaunch()` is harness code, not a service feature.** The service launches the app
  once, and restarts it only between spec files, when it's dead. The helper sends
  SIGTERM, respawns the binary with the same env plus `TAURI_WEBDRIVER_PORT` and
  `WDIO_EMBEDDED_SERVER`, waits for `/status`, then calls `browser.reloadSession()`.
  `onComplete` kills any app it left behind.
- **A whitespace-only prompt counts as empty** (both in the UI and in Rust). The
  prompt that is sent is never trimmed.
- **Session `cwd`s aren't canonicalized; added repos are.** Real `agents --json`
  reported the canonical path, so they merge. A session started through a symlinked path
  would show as a second group. That is unproven either way.
- **A failed "Add repo…"** (a picked path that is gone) only logs to the console. The
  native picker only returns folders.

### Verified

- `cargo test`: 36 passed, including the parse test against the real bytes, byte-exact
  argv, `cwd` and the failure text, and `repos.json` dedupe through a symlink.
- **Items 5–11** pass under `npm run e2e`. The whole suite has 54 passed.
  `e2e/new-session.spec.ts` (5–8), `e2e/add-repo.spec.ts` (9–10) and
  `e2e/repos-claude-dir.spec.ts` (11) are by `e2e-author`, dispatched from this session.
- **Breaks,** each applied, run and reverted by a scratch script. Each turned red
  exactly the claims named:
  - An extra `bypassPermissions` mode turned item 5 red.
  - Newlines replaced in the prompt turned 6's byte-exact claim red.
  - A flag under Default turned 6's argv claims red.
  - Start enabled when the prompt is empty turned 6's empty-prompt claim red.
  - No select after listing turned item 7 red.
  - Stderr dropped, and the prompt cleared on failure, each turned 8's failure claim
    red.
  - No canonicalize turned 9's two symlink claims red.
  - No save turned 8 of 9–10's claims red.
  - A session group split from its added repo turned 9's "already has sessions" claim
    red, and 10's "group stays".
  - "Remove from list" on every group turned 10's "no such item" claim red.
  - A remove that isn't saved turned 10's `repos.json` claim red.
  - `repos.json` written into the Claude dir turned item 11 red.
- **The unlisted-id clause of item 8 needed a spec fix.** The spec checked
  `attaches(id) === 0` at the instant the message appeared. A break that attached at
  that same moment stayed green, because the fake's attach takes a few hundred ms to
  log. `e2e-author` changed it to hold for 3s. It now goes red, but only when the box
  *and* `pty_spawn` are both broken: `pty_spawn` refuses an id that the last poll
  didn't list, so a frontend-only break can't attach.

### Harness defects found on the way

- **The brief dropped failed hooks.** A failing `afterEach` makes mocha skip the rest
  of its suite without reporting those tests, so a break showed "1 passed, 1 failed"
  out of 10. `brief-reporter.ts` now records a failed hook as a failure.
- **The repo path has a space** (`Github Repos`). A `ps` match on
  `command.split(" ")[0]` found no app, so the first `relaunch()` killed nothing, and
  the check passed for the wrong reason. The match compares the full binary path now.

### Not verified at merge; item 12 checked afterwards

**Item 12** (by hand, release app) was open at the merge. Driving the window needs
Apple Events, which a `claude --bg` job can't send.

**Item 12 passed on 2026-09-28**, after the merge. `/Applications/Oscillate.app` was
rebuilt from `df30efc` (slices 1 and 2) and reinstalled. The author clicked "+" on
`~/Github Repos`, chose plan mode, and sent a throwaway prompt. The new row was
selected and attached. `claude agents --json --all` (2.1.284) listed `1e30ab73` with
`cwd` `/Users/khalilbrewington/Github Repos`, started at 20:19:33, and its one
`claude attach 1e30ab73` was a child of the installed app. `claude rm` removed it.
Plan mode was the author's choice in the box. The daemon's process args
(`claude bg-spare …`) don't show the mode, so it wasn't checked separately.

---

## 2026-09-28 — Chapter 3, slice 1: rows stay still

Chapter 3 was decided first. `PLAN-new-sessions.md` holds its head: the choices, what
was rejected, and items 1–22.

### Why rows moved

`startedAt` in `agents --json` is when the session's *current process* started, not when
the session was created. This job's `state.json` said `createdAt` 07:24, while
`agents --json` said `startedAt` 14:15, the time of its last respawn. Attaching a paused
or done session respawns it, so it jumped to the top. That was the unverified cause
noted in slice 3.

### What was built

- `sessions::FirstSeen`: a `key → startedAt` map that the poll thread keeps for the life
  of the process. It stamps every list with `sortKey` before diffing or emitting it.
  Because the map lives in Rust, not React, `sessions_snapshot` carries the frozen
  order across a webview reload.
- `groups.ts` sorts rows by `sortKey`, newest first, with ties broken by `key`.
- Two unit tests (a respawn plus a rename keeps the key; a new key uses its own
  `startedAt`).

### Verified

Items 1–4 pass under `npm run e2e` (`e2e/sidebar-order.spec.ts`, by `e2e-author`).
Whole suite: 30 passed.

- **Breaks:** sorting by live `startedAt`, by name, oldest first, and a no-op stamp at
  the root each turned all four red. The claims build on each other in file order, so
  an early break cascades. A snapshot with its sort keys stripped, which is the reload
  path's own entry point, turned **only item 4** red.
- **Not reproduced:** the author's first run timed out item 1's wait for 10 more polls
  (40s, where ~20s is expected). The next five runs took 22.5s each for that claim,
  including one started at a load average of ~20. The failed run's poll timestamps are
  gone, so the cause is unknown.
- **The `e2e-author` run stalled** after writing the spec and running it once (no
  progress for 600s). The spec on disk was complete. The breaks and reruns were done
  by the coding session, which never edited the spec.

### Specs no longer need a second session

`e2e-author` was dispatched in the same session that wrote the code. The two-session
split (`NOTES.md`, *Chapter 2 closed*) existed only because the agent was defined in the
session that needed it. Now that it's committed, any session started from this directory
can dispatch it. The independence rule stands: the coding session never writes or
edits a spec.

### Not installed

`/Applications/Oscillate.app` was not rebuilt, so it still sorts by live `startedAt`.
Reinstalling means quitting the running app, which closes its attached panes (see
*Current state* in `CLAUDE.md` for the steps).

### Cargo flakes under load

At a load average of ~4.5 (other background sessions running), two timing tests flaked:

- `a_failed_poll_waits_the_retry_interval` failed on its **first-start** wait (1s),
  with and without this slice's change. That wait isn't the claim, so it's now 3s.
- `item5_a_touch_repolls_within_300ms` failed once in three runs. 300ms is the
  criterion's own bound, so it was left as is. If it recurs, measure under load before
  touching either the bound or the watch.

---

## 2026-09-28 — Chapter 2 closed: every session, one click away

All four slices shipped. The app lives in `/Applications`, lists every session grouped
by repo, and attaches one on a click. `PLAN-sessions.md` was deleted with this entry.
Its full text (the question, what was chosen and rejected, the acceptance criteria and
the implementation notes) is at commit `3eaa774`:
`git show 3eaa774:PLAN-sessions.md`. The decisions that outlive the chapter:

- **The resolver is cached in memory, warmed at launch, and re-resolved once** when
  the cached binary is gone (ENOENT or exit 127). `OSCILLATE_CLAUDE_BIN` skips the
  shell.
  - **Rejected:** a cache that is never cleared (an nvm switch would need a restart,
    with no hint why), and a TTL re-run (an arbitrary N, and a login shell over and
    over for a change that almost never happens).
  - **Rejected:** persisting the answer to disk. A stale PATH would be handed to any
    daemon an attach starts, and every background session inherits it.
- **← counts as a detach.** A 250ms watch reads each attach pid's argv and kills it
  once it has become agent view, so the PTY's record of its session stays true
  (invariant 3).
  - **Rejected:** reattaching at once (each stray ← would cost a recap), swallowing ←
    in the frontend (it also moves Claude's cursor), and following agent view's pick
    (`agents --json` has no client field, so the record would be a guess).
- **Attach runs in the session's own `cwd`**, and a `cwd` that no longer exists is
  refused. **Rejected:** `$HOME`, or falling back to it. Agent view asks for trust
  there, and the watch would kill a process sitting at the trust prompt.
- **At most 6 live panes, least recently viewed evicted, held to 1 GiB and 20% of a
  core.** Measured: 893 MiB and ≤ 2% for six idle panes. If a later change fails the
  budget, the cap drops; the budget does not rise. **Rejected:** 4 (ordinary switching
  keeps costing recaps), 8 (an estimated ~850 MiB before xterm's own cost was known),
  and no cap.
- **Clipped's e2e discipline, with the gate on merge.** `e2e-author` writes every
  spec, without reading the implementation, and a hook refuses spec writes from anyone
  else. A merge into `main` needs the branch's exact tree green, or `E2E: none — <why>`.
  A slice with specs spans two sessions, and a spec counts only once a break has turned
  it red.
  - **Rejected:** the coding session writing its own specs (a spec can share the code's
    misreading), an inline subagent as author (no stable `agent_type` to lock on), a
    rule with no hook (a session forgets it), a push gate (no remote), and gating every
    commit on `main`.
- **The app ships as an ad-hoc-signed `.app` built by `tauri build` alone** (slice 4,
  below).

What the chapter left unproved, each in `BACKLOG.md`: the sidebar's load path is
covered only incidentally, rows re-sort when a session is attached, and item 24's
daemon clause.

## 2026-09-28 — Chapter 2, slice 4: ship to the Dock

`Oscillate.app` is built, ad-hoc signed, has its own icon, and is installed in
`/Applications`. Items 23 and 24 pass, except that 24's daemon clause couldn't be
triggered (below).

### What was built

- **`tauri.conf.json`:** `bundle.targets` is `["app"]`, and
  `bundle.macOS.signingIdentity` is `"-"`. So `npx tauri build` alone produces the
  signed bundle, then `ditto` installs it (`CLAUDE.md`). The e2e build is
  `--no-bundle` and doesn't read either setting.
  - **Rejected:** `targets: "all"`. The DMG step adds a script and a disk image nobody
    downloads, because the app is only ever installed on this Mac.
  - **Rejected:** running `codesign -s -` by hand after each build. The config makes
    the signature part of the build, so a reinstall can't skip it.
- **The icon** is two sine waves in antiphase, amber over a dimmer teal, on a dark
  indigo squircle drawn to the macOS 824/1024 grid. Its source is
  `src-tauri/icons/app-icon.svg`, and every size is regenerated with
  `npx tauri icon src-tauri/icons/app-icon.svg`. Only the files the repo already had
  were copied in; the generated `android/`, `ios/` and `64x64.png` were dropped.
  **Rejected:** keeping Tauri's default logo. It passes "with an icon" in letter only,
  and it looks like every other Tauri app in the Dock.

### Verified in the running app

| # | Item | Result |
|---|------|--------|
| 23 | In `/Applications`, icon, ad-hoc | **Pass.** `codesign -dv`: `Signature=adhoc`, flags `adhoc,runtime` (Tauri turns on the hardened runtime by default, and nothing broke under it), `Identifier=dev.oscillate.app`. `codesign --verify --deep --strict` passes. `spctl` rejects it, as it rejects any ad-hoc app. The bundle was built here, so it carries no quarantine attribute and opens without a Gatekeeper prompt. `Info.plist` names `icon.icns`, which was generated from the new SVG. |
| 24 | Finder launch: list within 2s, a click attaches | **Pass, but the daemon clause wasn't triggered.** The app was opened through Finder (`tell application "Finder" to open POSIX file …`). Its parent is launchd, and its environment has `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, with no `TERM`. Its `claude agents --json --all` polls resolve to nvm's `claude`, with the login shell's full PATH. **Timing, over 5 Finder launches:** the window appeared 0.36–0.50s after the open, and the first poll finished 0.96–1.16s after the window. The login shell (`zsh -lic`) was most of that, at about 1–1.4s. The author confirmed the sidebar matched `claude agents --json --all` (5 sessions in 4 groups, the terminal-tab row dimmed), then clicked rows. Each click started one `claude attach <id>` in that session's own `cwd`, with the login shell's PATH and `TERM=xterm-256color`. |

- **The daemon clause wasn't triggered.** The supervisor daemon was already running,
  and it hosts the session that ran these checks (a `claude --bg` job), so stopping it
  wasn't an option. What was shown instead: the attach's own environment has the login
  shell's PATH. Chapter 1, slice 2 showed that a daemon started by an attach inherits
  the attach's PATH. A direct check is in `BACKLOG.md`: look at the daemon's PATH the
  next time an Oscillate click starts it.
- **How the timing was measured.** A Swift loop over `CGWindowListCopyWindowInfo`
  timed the window's first appearance: a layer-0 window owned by `oscillate`. That
  call needs no Accessibility or Apple Events permission. A 20ms `ps` sampler timed
  the app's children. Both were throwaway scripts in the job's tmp directory.
- **A `claude --bg` job can't drive the GUI.** `osascript` to System Events fails with
  `-1743` (not authorized to send Apple events), so `drive-window` doesn't work from a
  background session. Apple Events to Finder do work, and that is what made the Finder
  launch possible. The click was made by the author.
- The throwaway session was `claude --bg --permission-mode plan` in `~/Github Repos`,
  named "Oscillate slice 4 probe", and `claude rm`'d afterwards.

## 2026-09-28 — Chapter 2, slice 3: click to attach, with a pool of panes

Slice 3 is built, specified, broken, verified in the running app, and merged. The
implementation summary is in `PLAN-sessions.md`, below the marker. Items are numbered
as in the plan.

### The specs

`e2e-author` wrote one spec per item, each with its criterion quoted verbatim, one
dispatch at a time: `attach-cwd` (13), `attach-switch` (14), `attach-left-arrow` (15),
`attach-ctrl-z` (16), `attach-stress` (17), `attach-vanish` (18), `attach-lru` (20) and
`attach-dead-pane` (22). Items 19 and 21 can't be driven by the harness and were checked
in the running app. The suite is 26 claims.

Reading each spec before accepting it found three that proved less than they said.
Each went back to the author with the reason:
- **Item 15's ten tries were one try, ten times.** Each ← came a nearly constant time
  after the previous detach, so every try hit the 250ms watch at the same phase. A
  600ms watch stayed green. A seeded 0–1s delay before each ← fixed it, and the 600ms
  break now goes red. **Rule:** a repeated timing claim needs jitter, or its samples
  aren't independent.
- **A page-global `$("button*=Detached")`.** Hidden panes stay mounted, so it could
  match another pane's message and make item 15's latency vacuous. Now it is scoped to
  the pane.
- **A `timeoutMsg` built before the wait.** It said "agent view never appeared" on
  every timeout, including one where agent view had appeared.

The authors' workarounds were findings too. Each was fixed in the app, not accepted
in the spec:
- **Focus was lost after a reattach.** The button unmounted under the click, and focus
  fell to `<body>`. The spec had clicked into the terminal before typing, as a user
  would have had to. Now the pane focuses its terminal once live.
- **Keys typed while attaching were dropped.** `pty` was set only once `pty_spawn`
  resolved. The pane now holds them and sends them once live.

### Four app bugs, and how each surfaced

1. **The watch killed a fresh attach before its exec** (surfaced as a flaky LRU spec,
   about one failed claim per run).
   - A fresh pane showed "Detached" and the fake never logged its attach.
   - Temporary logging showed the watch reading the child's argv in the spawn's own
     millisecond and seeing **the app's own argv**. portable-pty's spawn can return
     before the forked child has exec'd.
   - Fix: the watch arms only once it has seen `attach <id>` (`left_attach`, unit
     tested). Then 48/48 LRU claims passed.
2. **A closing PTY's child could never be reaped** (only real `claude` showed it; see
   *Verified in the running app*).
   - The reader stopped reading at close. Real agent view answers SIGHUP by writing,
     and blocks on a full tty queue.
   - The 2s SIGKILL escalation then left it stuck in exit (`ps` STAT `E`) for good. It
     was waiting for output to drain from a master nobody read. So no Detached, the
     reader thread blocked in `wait4`, and a reattach was refused as "still detaching".
   - A scripted PTY confirmed it: hung up and not read, agent view was still alive
     after 4s. Read, it exited in 0.46s; SIGKILLed, it exited in 0.02s. Plain `perl` in
     the same spot exits in 0.6s, since macOS times out the drain. The difference is
     agent view's hangup handler.
   - Fix: the reader reads until EOF and drops output after close.
   - The fake only reproduced it once its agent view kept repainting **and** wrote on
     hangup. Painting once wasn't enough, because the app was still reading then. With
     both, item 15's spec went red before the fix.
3. **← was too slow on real `claude`.** Hung up, agent view takes about 0.5s to exit
   even when read. 5 of 10 tries took 527–784ms from exec to gone.
   - Fix: the watch SIGKILLs agent view's group. It's only a viewer, and Oscillate
     resets xterm's modes itself.
   - After: 51–233ms, 10 out of 10.
   - Every other close (quit, eviction, vanish, the pane's own) keeps SIGHUP. That is
     a real `claude attach`, whose detach matters.
   - **Rejected:** showing "Detached" at close rather than at reap. It's more state,
     and a reattach has to wait for the reap anyway (invariant 3).
4. **Output before `pty_spawn` resolved was never acked** (found by reading the code).
   `flushAck` zeroed the count while the PTY's id was still unknown, which leaked
   in-flight bytes toward the 1 MiB backpressure. No spec covers it.

### The harness

- **This WebDriver sends wrong `keyCode`s.** `browser.keys("x")` reached xterm.js as
  `x` plus `CSI 20~` (F9), and Ctrl+Z as `CSI 23;5~`: the character code lands in
  `keyCode`. `press()` dispatches correct keydowns to the focused pane instead.
- **`browser.action('wheel')` isn't forwarded at all.** Item 22 dispatches a
  `WheelEvent` itself.
- **The fake logs agent view at the exec, not after it.** The app hangs the pid up
  before the exec'd Perl has run a line, and item 15 failed until the log line moved.
- **`fake.repo()` resolves the path** (`/private/var`), since `getcwd` does.
- **Full-suite flakes under load were mostly bug 1.** The author saw rotating failures
  while building and running at the same time, with a load average of 5–7. After the
  fix, the suite was green 3/3 on a quiet machine.
- **Cost:** the author's dispatches ran 3–64 minutes each. The longest were item 15's
  first round (64) and item 22 (45).

### The breaks

Each break was patched in, run against the full suite, and restored. The table is
the final code's:

| Break | Red |
|---|---|
| `Pty::close` never signals | 3: items 15 and 18 (both) |
| Attach in the app's cwd | 1: item 13's `lsof` claim |
| No check for a missing cwd | 1: item 13's removed-dir claim |
| Only the selected pane mounted | 5: items 14, 18 ×2 and 20 ×2 |
| The watch never detaches | 2: items 15 and 17 |
| The watch every 600ms | 1: item 15 (green before the jitter fix) |
| No Detached message on exit | 4: items 15, 16 ×2 and 22 |
| Every row click reattaches; old attach never killed | 4: items 17 and 20 ×3 |
| The same, plus Rust's invariant-3 guard removed | 5: items 14, 17 and 20 ×3 (17 sees two pids for one id) |
| Rust closes no unlisted PTYs, frontend keeps their panes | 6: items 18 ×2, 20 ×3 and 10 |
| LRU evicts the first opened | 2: item 20 |
| LRU evicts the most recently viewed other pane | 3: item 20 |
| The cap is 7 | 3: item 20 |
| Dead input held and sent to the next attach | 1: item 22 |
| Reader stops at close **and** agent view gets SIGHUP | 2: items 15 and 17 |

Six stayed green, and each is understood:
- **Rust never closes unlisted PTYs** (the frontend still unmounts). The unmount kills
  the PTY too, so item 18 holds on either layer. The pair together goes red. Rust's
  layer alone isn't proved.
- **The visible pane can be evicted.** This is equivalent to the real code: the visible
  pane is always the most recently viewed, so LRU never picks it. "Never the visible
  one" follows from LRU itself.
- **Dead input held, first version.** Equivalent: `start()` reset the buffer anyway.
  The second version survives the reset and goes red.
- **The reader stops at close**, and **agent view gets SIGHUP**, each alone. Against
  the fake, either fix is enough: SIGKILL skips the hangup handler, and draining lets
  it finish. Together they go red.
  - Against real `claude`, draining alone was measured too slow (5 of 10 over 500ms).
    SIGKILL alone wasn't measured in the app.
  - The drain stays for every SIGHUP close (quit, eviction, vanish). There a real
    attach is hung up, and whether it writes on hangup is unverified.
- **No input-mode reset on exit.** Not needed for item 22's 0 bytes: a dead pane has
  no PTY to write to, and a reattach resets the terminal. The reset only keeps a dead
  pane's mouse doing selection instead of reports. No claim covers it.

### Verified in the running app

Checked on the release build against real background sessions: six throwaway
`claude --bg --permission-mode plan` sessions in `~/Github Repos`, `claude rm`'d
afterwards. The tools were `drive-window` (with `point X Y` and `PANE_LEFT` added),
`ps`, `lsof` and `measure-footprint`.

| # | Item | Result |
|---|------|--------|
| 13 | Attach in the session's cwd | **Pass.** `lsof -d cwd` on each attach shows `~/Github Repos`, the sessions' `cwd`. The removed-directory half is covered only by e2e. |
| 14 | Switching never reattaches | **Pass.** Five attach pids were unchanged across A → B → A, and no recap appeared in A. |
| 15 | ← detaches | **Pass, after bugs 2 and 3.** 10 out of 10: exec → gone in 51–233ms, a reattach through the Detached button each time, and no agent view left behind. Before the fixes: try 3 of 10 stuck in exit, then 5 of 10 over 500ms. |
| 19 | Quit leaves no attach | **Pass.** Three attaches, then Cmd+Q: 0 left 200ms later, and every session still listed. The same held on the build with the stuck PTY: the quit released it. |
| 21 | Budget | **Pass.** Six idle panes: **893 MiB, ≤ 2.0% CPU**, steady over 3 minutes of 30–60s samples. App 28, WebKit GPU 31 / Networking 6 / WebContent 436, and six attaches at 65–68 each. With no panes, WebContent was 36, so **each xterm pane costs about 67 MiB**. |

- **`claude attach` started the supervisor daemon as its own child.** The daemon had
  exited while idle. It leads its own process group and session, so it outlives the
  attach, and Oscillate's `killpg` never reaches it.
  - `measure-footprint` counted it and its fourteen hosts and spares as the app's
    (2.19 GiB). The script now stops at a grandchild that leads its own process group.
- **Sidebar rows re-sorted when sessions were attached.** Rows are newest first by
  `startedAt`, and after attaches the probes' order changed, so a click by position
  opened the wrong session. Why `startedAt` moved isn't verified. In `BACKLOG.md`.
- **Agent view ignores a lone SIGHUP while its output isn't read.** An orphaned one
  stayed alive after `kill -HUP`, which is bug 2 from the outside.
- **A screenshot caught another app in front** while the author was at the Mac. It
  was deleted, and the GUI checks waited until they stepped away. Driving the GUI
  needs the Mac to be idle.

---

## 2026-09-27 — Chapter 2, slice 3: ← is an `exec` in the same pid

This settles `PLAN-sessions.md`'s first *Still open* item before any detection was built.

- **How it was checked.** A throwaway `claude --bg --permission-mode plan` session was
  started in `~/Github Repos` (trusted). A Python PTY attached it with Oscillate's clean
  environment and the login PATH, at 120×40, and pressed ← (`CSI D`). `ps` sampled the
  PTY's process tree every 50ms. That was done twice, with the same result.
  - A scripted PTY, not the app through `drive-window`: it samples faster than a
    screenshot loop, and a trusted cwd means no trust prompt. The app at this commit
    still attaches in `$HOME`, where agent view would ask for trust.
- **The result.** About 275ms after the key, the attach pid is still the same pid, with
  the same ppid and pgid. Its argv has changed from `…/bin/claude attach <id>` to
  `<realpath of claude.exe> agents`. Agent view then spawns short-lived children (`ps`,
  `bash`) in the same process group. Closing the PTY master ended it: only the zombie
  was left, since the probe never reaped it.
- **What that means for detection:**
  - It watches one pid per PTY, the child it spawned. There's no tree walk.
  - It reads the argv with `sysctl(KERN_PROCARGS2)` and matches on the arguments
    (`attach <id>`), never `argv[0]`. `argv[0]` changes from the nvm symlink to the
    resolved `claude.exe`.
  - It needs no tree kill: closing the PTY hangs up the whole foreground process group.
- **What it cost to find out: the disk was full.** 166 MiB were free at session start.
  A Claude Code auto-update at 18:26 had died mid-install. It left `bin/claude`
  missing, a 500-byte stub `claude.exe`, and the working 2.1.283 in npm's set-aside
  dir, so `claude` resolved nowhere. The running daemon kept its open binary.
  - `src-tauri/target/debug` (3.8 GiB) was cleared, with the author's OK.
  - The first `npm i -g` failed with ENOTEMPTY on npm's own rename. It succeeded after
    the set-aside dir was moved out of the way.
  - An app running at the time would have hit the resolver's "`claude` not found"
    path on every lookup until the reinstall. That is the slice 1 retry case, but for
    hours rather than seconds.

---

## 2026-09-27 — Chapter 2, slice 2, session B: the specs, the breaks, the merge

Slice 2 is merged (`7d2eb88`, a fast-forward through the gate). Items 9–12 pass.

- **The specs.** `e2e-author` wrote them, one dispatch per item, each with its
  criterion quoted verbatim: `sidebar-groups` (9), `sidebar-rows` (10) and
  `sidebar-updates` (11). The full suite is 12 claims, green on a clean tree, and the
  tree is recorded for the gate (item 12).
- **Dispatch the author one item at a time.** Every spec run shares one e2e build dir,
  one WebDriver port and one `.results/`. Parallel authors would collide.
- **Read each spec before accepting "green".** As first written, two of the three
  passed while proving less than their criterion:
  - Item 9's collapse claim asserted `not.toBeDisplayed()` on `$("*=a6idle")`. That
    passes whether or not anything collapsed, because a bare `*=text` is WDIO's
    partial **link-text** selector and matches only `<a>`. Now it counts displayed rows
    in the group: 2, then 0, then 2.
  - Item 10 checked the dot on 2 of the 9 sessions, and only that it had a name. Now it
    counts 9 dots for 9 sessions, and requires different states to have different dot
    names.
  - Both went back to their authors with the reason; neither was edited here.
  - **Rule:** a negative assertion counts only on a locator that has matched before.
    The `*=` pitfall is now in `e2e/README.md` for the next author.
- **The breaks.** Each was run against the full suite, then restored:

  | Break | Red |
  |---|---|
  | `groupSessions`: every session in one group | 5: item 9 ×4, item 10's terminal-tab claim |
  | Labels are the basename alone (no disambiguation) | 2: item 9's collision claims |
  | Disambiguation stops after one parent segment | 1: item 9's deep-collision claim |
  | The `sessions-changed` listener drops its payload | 4: items 9, 10 and 11 (both) |
  | The watch never triggers (`relevant` forced false) | 1: item 11's 0.5s-after-touch claim |
  | `sessions_snapshot` always `None` | 2: item 9's first two claims |

  - The first try at the disambiguation break (`break;` in place of
    `if (!deepened) break;`) didn't compile: `tsc` rejects a variable that is written
    but never read. That is why the table has two disambiguation breaks.
- **The load path is covered by accident.** No spec reloads the page. The snapshot
  break goes red only because the fake starts on `all-states`, and the first spec's
  first `show("all-states")` changes nothing. No event fires, so the snapshot is all
  the page has. A different spec order or a different default fake would lose it. A
  deliberate claim is in `BACKLOG.md`.
- **Two spec-maintenance costs, accepted:**
  - `sidebar-groups` reads a group's count by span position (`spans[2]`), so moving the
    header's chevron breaks it without the app being wrong.
  - `snapshot.check.ts` lists a span only when it has text, so the author couldn't see
    the chevron's empty span in `snapshot.txt` and found it live.

---

## 2026-09-26 — Chapter 2, slice 2, session A: the sidebar and the harness

Built on `ch2/slice-2-sidebar`; the implementation summary is in `PLAN-sessions.md`
below the marker. What building it decided, and what it cost to find out:

- **Two Rust gaps.** The handoff said slice 1 had everything the sidebar needed. It was
  missing two things:
  - `sessions_snapshot` answered `[]` both before the first poll and when there really
    were no sessions. The empty state would have flashed at every launch, and stuck if
    the first event fired before the page listened. It now returns `null` until a good
    poll.
  - The watched `~/.claude` was hard-coded, so an e2e touch test would have touched
    the real directory. `OSCILLATE_CLAUDE_DIR` moves it.
- **The WDIO plugins sit behind a cargo feature, not `cfg(debug_assertions)`** as the
  plugin's docs suggest. Otherwise `npm run tauri dev`, in daily use, would open a
  WebDriver port.
  - Their capability goes inline in `tauri.e2e.conf.json`, merged with `--config`
    only by the e2e build. `tauri-build` validates the merged config, so a normal
    build never sees a `wdio:` permission it can't resolve.
  - `tauri-plugin-wdio-webdriver`'s default permission set is empty; only
    `wdio:default` is needed.
- **The service spawns one app per run** (in its launcher `onPrepare`, with
  `{...process.env, ...options.env}`).
  - So the fake `claude` is created once, when the config loads. Its path reaches the
    app through the service's `env`, and the workers through `process.env`.
  - Specs change what the fake answers instead of relaunching the app.
- **The merge gate records green; it doesn't run the suite.** At merge time the
  checkout is on `main`, so running the suite there would test `main`'s code, not the
  branch's.
  - A full, green `npm run e2e` on a clean checkout appends `HEAD^{tree}` to
    `<git-common-dir>/e2e-green`. The gate allows a merge whose incoming tree is
    recorded.
  - A single spec, a `.check.ts` run, or a dirty tree records nothing.
  - **Rejected:** running the suite from the gate in a temp worktree of the branch. It
    means a second `node_modules`, and a cold 1-minute cargo build in a second target
    dir, on every merge.
- **Hooks and agents load from the directory a session starts in.** This session
  started in `~/Github Repos`, so `oscillate/.claude/settings.json` never loaded: a
  `Write` to `e2e/*.spec.ts` went through. Run by hand, the lock refused the same
  input.
  - This is the same lesson as clipped's worktree one, and it matters here because
    earlier handoffs sent sessions to `~/Github Repos`.
  - **Session B must start in `oscillate/`**, or the author can't be dispatched and
    the lock isn't armed.
- **A gate has to be on `main` before the merge that brings it.** The hook's command
  runs `$CLAUDE_PROJECT_DIR/.claude/e2e-merge-gate.sh`.
  - Checking out `main` to merge a branch that is the only place the script exists
    removes it. bash exits 127, a non-blocking hook error, and the merge goes through
    ungated.
  - So `.claude/` landed on `main` on its own (`608bd5e`), which the gate itself
    allows as docs-only. From `main`, a real `git merge ch2/slice-2-sidebar` now exits
    2: "app changed, no spec".
- **Screenshots while the Mac is locked.** The lock screen hides every window from
  System Events, so `drive-window` can't find one. WebDriver's `saveScreenshot` still
  works: the embedded driver snapshots the webview itself.
  - The xterm canvas comes out blank, and a 28pt strip shows at the bottom where the
    title bar is offset. Both are artifacts of the snapshot.
  - The sidebar was checked this way against `all-states`, `empty`, a collapse, and
    the real `claude agents --json --all` output (three sessions: one background, two
    terminal tabs).

---

## 2026-09-26 — Chapter 2, slice 2: porting clipped's e2e discipline

This settles the *Undecided* entry before any spec exists. The decision and the rejected
options are in `PLAN-sessions.md` (*Chosen* and *Rejected*). This entry records what
bore on it.

- **The harness runs on macOS,** which the whole question depended on.
  `@wdio/tauri-service` 1.4.0 supports macOS through its `embedded` driver, a
  `tauri-plugin-wdio` compiled into the app. `tauri-driver` (`external`) is
  Windows/Linux only, and `crabnebula` needs a paid key. Keeping the plugin out of
  release builds is a planning question.
- **Clipped's gate is a push gate, and Oscillate has no remote.** Ported as-is, it
  would never fire. The handoff point here is the merge of a slice branch into `main`,
  so the gate moves there.
- **Three lessons from clipped shaped it** (clipped's `NOTES.md`, 2026-09-24 and
  2026-09-25):
  - `.claude/agents/` is read at session start, so a new agent means a session
    boundary. Hooks reload live.
  - A spec lock that fires on a spec being *mentioned* teaches workarounds. It must
    key on a spec being the *target* of a write.
  - The gate judged `$CLAUDE_PROJECT_DIR` rather than the checkout, and a worktree's
    push got through as docs-only.
- **Independence is in the order as well as the agent.** In session B the sidebar
  already exists, so the author finds things through the accessibility tree. Its
  assertions come from the criteria and the fake `claude`'s fixtures, not from what the
  screen happens to show.

---

## 2026-09-25 — Chapter 2, slice 1: the session model

The session model is Rust only, with no UI: `claude.rs` (the resolver), `sessions.rs`
(the mapping), `poll.rs`, and `watch.rs`. Items 1–8 in `PLAN-sessions.md` are checked by
`cargo test` (22 tests) against fixtures and a fake `claude`. A process watch during the
run saw only the fake, never the real `claude`. Items are numbered as in the plan.

| # | Item | Result |
|---|------|--------|
| 1 | One lookup | **Pass.** 100 calls make 1 lookup; 8 concurrent first callers make 1; `OSCILLATE_CLAUDE_BIN` runs no shell. In the app, one lookup across launch, the first poll and every later poll. |
| 2 | Re-resolve on failure | **Pass.** A vanished binary makes exactly one more lookup, and a failed lookup isn't cached. |
| 3 | Window doesn't wait | **Pass.** With `SHELL` set to a script that sleeps 3s, the window was up and screenshotted 1.5s before the lookup finished (4.3s). |
| 4 | Serialized, every 2s | **Pass.** No overlap under a trigger every 200ms against a 3s poll. The steady-state gaps are 2.00 ± 0.02s. |
| 5 | The watch re-polls | **Pass** in a temp dir with real FSEvents: a touch re-polls within 300ms; a burst of 20 makes at most 2 polls; `.jsonl` churn makes none. |
| 6 | Quiet diff | **Pass.** |
| 7 | Total mapping | **Pass**, including an unknown `state`, a `null` one, and a bare entry. |
| 8 | Failed polls | **Pass.** Non-zero exit and garbage keep the last list, and the next good poll emits. |

In the dev app, the first `sessions-changed` matched `claude agents --json --all` entry
for entry, 2.3s after setup. The resolver's lookup took **1.62s in the app**, not the
0.96s measured by hand in chapter 1, which is more reason to warm it.

### What building it decided

- **The resolver re-checks the cached path with a stat on every call**, instead of
  having each call site classify spawn errors (`NotFound`, exit 127) and retry. That
  was the plan's version; the stat is one line and catches the nvm-switch case before
  any spawn. **Rejected:** the call-site retry, which every new caller would have to
  remember.
- **The watch only reacts to `sessions/*.json` and `jobs/*/state.json`.** A job
  directory also holds `timeline.jsonl` and `tmp/`, which a streaming session can write
  continuously, and every event would cost a 0.13s `claude agents` run. Only the event's
  path is looked at, never a file's contents (invariant 5).
  - **Rejected:** reacting to every event.
  - **Rejected:** a minimum gap between polls started by triggers, which would also
    delay a single real change. Add it only if the filtered rate proves high.
- **UI states:**
  - `paused` means `state: working` without `status: busy`: a background job that is
    idle, or has no live process.
  - An entry with no `id` is `terminal-tab`, because `claude attach` needs the id.
  - A new `state` string maps to an eighth value, `unknown`, and keeps the raw string.
    **Rejected:** folding it into `working`, which would mislead.
- **A failed poll waits 10s before the next timed try**, so a missing `claude` doesn't
  cost a login shell every 2s. A file-watch trigger still polls at once.
- **Testing timings:** tests that start a poller share one lock, so they don't skew
  each other's timings. A freshly written fake's first run reaches its log about 200ms
  late (the first gap measured 1.80s every time), so the interval test measures from
  the second poll.

### What a longer run in the app showed

- **The watch fires on real files.** When a Claude Code session changed status, its
  `~/.claude/sessions/<pid>.json` changed, and the filter marked the event relevant.
  Nothing under the watched directories changed in the first 4 minutes: session files
  are written on status changes, not continuously.
- **Claude Code auto-updated mid-run (2.1.282 → 2.1.283), and the resolver
  recovered.** While the update reinstalled, the `claude` path briefly didn't exist.
  The stat missed and the login shell couldn't find `claude` either, so one poll failed
  and waited the 10s retry. The next lookup found the new binary; there was no restart
  and no stuck state.
  - **For slice 3:** an attach clicked during that window fails once, and the pane
    must say so and allow a retry. `claude attach` processes already running keep the
    old binary.

## 2026-09-25 — Chapter 1 closed: go

Slice 2 held against the amended bars, with no unfixable item, so **the stack stays**
and chapter 2 starts on it. `PLAN-terminal.md` was deleted with this entry. Its head
(the question, what was chosen and rejected, the acceptance criteria and the go/no-go)
is in git at the commit that recorded the verdict: `git log --all -- PLAN-terminal.md`.
The decisions that outlive the chapter:

- **Frontend: React + TypeScript on Vite.** It pays off in chapter 2's sidebar diffs
  and chapter 3's prompt box. **Rejected:** vanilla TS (a hand-written render loop),
  Svelte 5 and Solid (fewer Tauri + xterm examples to borrow from).
- **The baseline is Ghostty**, what Claude Code runs in today. **Rejected:** iTerm
  (not installed) and Terminal.app (too low a bar).
- **A hand-written PTY bridge over `portable-pty`**: raw bytes out through a Tauri
  `Channel`, writes and resizes through `invoke`, with Rust owning the lifecycle so the
  pool and invariant 3 can be enforced there. **Rejected:** `tauri-plugin-pty` (it
  hides the lifecycle) and `emit` events (JSON per chunk).
- **xterm.js** with WebGL (DOM fallback), fit, unicode-graphemes and web-links, plus
  OSC 8 through the opener plugin, and **the kitty keyboard protocol** (see slice 2
  below).

## 2026-09-25 — Chapter 1, slice 2: `claude attach` verified in the running app

Driven by Claude against a throwaway background session. It was started from a clean
environment with `claude --bg --permission-mode plan` in `~/Github Repos` (trusted),
and `claude rm`'d afterwards. The release build was attached with
`OSCILLATE_ATTACH=<id>`. Ghostty was attached to the same session at the same 80×42 for
the comparisons. The tools were `drive-window` (a `scroll` op was added for item 11),
`measure-footprint`, and a fake `claude` that logs the raw bytes it reads, for input
questions.

| # | Item | Result |
|---|------|--------|
| 9 | Detach | **Ctrl+Z passes**: `[detached from 6b99bf25]`, exit 0, and the session keeps running. **← does not detach.** `claude attach` execs `claude agents` (agent view) in place, in the PTY's cwd. That was `$HOME`, which then asked for workspace trust. "No, exit" left cleanly and trust stayed false. **Amended, below.** |
| 10 | Ctrl+C | **Pass**: one Ctrl+C gives "Interrupted · What should Claude do instead?" and the pane stays attached. Checked again after the keyboard change. |
| 11 | Wheel | **Pass**: scrolls Claude's fullscreen view both ways, with "Jump to bottom" shown. |
| 12 | 2–6 in Claude | **Pass.** (2) Option+B/F/Backspace. (3) Cmd+C with no selection is a no-op, and multi-line paste is intact. Claude's view owns the mouse, so drag and double-click select and copy on release, as in Ghostty. (4) Cmd+click on `https://example.com` opened the browser. (5) 👍🏽, 日本 and é align, and Claude's 24-bit colors render. (6) With Oscillate as the only client, 127×40 → 121×40 → 73×26 reflows cleanly. |
| 13 | Footprint | Idle attached (release): **220–224 MiB** total, of which `claude attach` is 63–65, WebContent 101–104, app 25–29 and GPU 22–24, at **2.7–3.1% CPU**. Mid-stream: **240 MiB at 5.8%**. For comparison, an idle shell pane was 156 MiB at 0.0%. |
| 14 | Streaming | **Pass**: a 35s turn with three Read calls and about 500 words. 200 paired captures of both windows were taken. The sampled pairs show the same frame at the same moment (same spinner timer and token count), and the final screens match. |

### What the checks found and fixed

- **`$SHELL -lc 'command -v claude'` finds nothing on this machine.** nvm is set up in
  `.zshrc`, which only an interactive shell reads. The resolver runs `-lic` (0.96s)
  and takes the last two stdout lines. **Rejected:** `-lc` as planned (it fails here);
  guessing install dirs (breaks on the next installer).
- **`claude attach` can start the supervisor daemon**, which hands its PATH to every
  background session. The resolver therefore also returns the login shell's PATH, and
  attach runs with it. The session started here had the full nvm/Homebrew PATH. Under
  `OSCILLATE_CLAUDE_BIN`, the base PATH is used, so a dev launch can't leak npm's.
- **Invariant 3 at the source.** StrictMode's mount → unmount → mount would have
  spawned two attaches, so the spawn is deferred one tick and the dead mount never
  starts one. Rust also refuses a second PTY for a live session, with the check and the
  insert under one lock.
- **Esc Esc and Ctrl+C on an idle prompt didn't clear Claude's input** in Oscillate.
  Both worked in Ghostty. The bytes were right (the keylogger saw `\x1b` and `\x03`).
  The difference is that Ghostty speaks the kitty keyboard protocol, which Claude's
  TUI switches to when offered. That makes Esc unambiguous. xterm.js 6.0 has no such
  support. The fix was **`@xterm/xterm` 6.1.0-beta.304**, with its addon betas pinned
  exactly, and `vtExtensions: { kittyKeyboard: true }`. After it, Esc arrives as
  `CSI 27u` and Ctrl+C as `CSI 99;5u`. Items 2, 3 and 10 were re-checked on it.
  - **Rejected:** hand-writing a kitty encoder on 6.0, which reimplements what
    upstream now ships.
  - **Rejected:** staying on 6.0. Esc Esc is daily muscle memory.
  - **The cost:** a beta dependency. Move to 6.1.0 stable when it ships (BACKLOG).
- **Dropped mouse releases were a false alarm.** One run lost every mouse-up. Another
  session's e2e windows were popping over Oscillate at the time, and neither 6.0 nor
  the beta reproduced it.
- The pane hides the cursor once its process exits.

### What `claude attach` means for Oscillate

- **The TUI is rendered by the daemon's `bg-pty-host`; attach is a byte pipe.** Two
  clients at different sizes share one render, and the other one shows leftover rules
  and unused rows. Side-by-side checks need equal sizes. Later, a session also open in
  the author's own terminal at another size will distort Oscillate's pane, which isn't
  an Oscillate bug.
- **Every attach posted a recap** (four times here), which confirms keeping each
  opened session's PTY alive.
- **← swaps the pane's process for agent view**, where picking another session attaches
  this same PTY to it. Oscillate's record of which session the PTY holds would then be
  wrong, and invariant 3 could break. Chapter 2 slice 3 has to handle this (BACKLOG).
- A stray `^[[I` can print after detach. It's a focus-in report racing Claude's exit
  while focus reporting is still on. Cosmetic.

### Amended: item 9

**Ctrl+Z detaches; ← opens agent view inside the pane.** That is Claude's documented
behavior (`claude attach --help`: "← returns to agent view"), and the terminal passed
the key through correctly. **Rejected:** counting ← as an unfixable item. It isn't a
terminal fault, and it would spend the go/no-go's tolerance on Claude's key map.

### How to repeat the side-by-side (item 14)

- Launch Ghostty's binary directly with `--window-width/height`,
  `--window-position-x/y` and `--background-opacity=1`, from `env -i` with the
  allowlisted variables. Then type `claude attach <id>` into its shell.
  - `open -na Ghostty.app --args … -e` opened extra tabs.
  - `-e` from the binary brings up an "Allow Ghostty to execute…" dialog.
- **Stage Manager must be off** or the other window is a thumbnail:
  `defaults write com.apple.WindowManager GloballyEnabled -bool false`, and back to
  `true` after.
- Match the two clients' `stty size` before comparing.

### An incident not to repeat

The `open -na Ghostty.app` launch opened a tab running plain `claude` in nvm's `bin`,
at the workspace-trust prompt. That process was killed rather than answered. Afterwards
`~/.claude.json` had `~/.nvm` marked trusted, with a start time and duration that
matched the killed process. The entry was removed with the author's OK. The cause isn't
verified, but the rule follows anyway: **answer a trust prompt with "No, exit"; never
kill the process sitting at it.**

## 2026-09-25 — Chapter 1, slice 1: verified in the running app

Driven by Claude through `osascript` keystrokes, CGEvent clicks and `screencapture`,
against a separate Ghostty instance at the same 127×40. Items are numbered as in
`PLAN-terminal.md`.

| # | Item | Result |
|---|------|--------|
| 1 | Login shell, `TERM`/`COLORTERM` | **Pass**: `xterm-256color truecolor`, `-zsh`. The "prompt within 1s" bar is **unmeetable as written**: the author's `zsh -lic exit` alone takes 1.37s (in Ghostty too). Oscillate's own overhead is 0.59s from window to shell spawn. |
| 2 | Option as Meta | **Pass**: Option+B/F/Backspace. |
| 3 | Cmd+C / Cmd+V | **Pass**: multi-line paste is byte-identical; double-click and drag copy exactly; Cmd+C with no selection neither copies nor interrupts. One early two-line copy did not reproduce. |
| 4 | Links | **Pass**: Cmd+click opens OSC 8 and plain URLs; a plain click does nothing. |
| 5 | Truecolor, emoji, wide | **Pass** after adding `addon-unicode-graphemes`. The gradient is smooth and CJK/combining marks align. zsh's line editor still draws 👍🏽 as two glyphs while typing, and its one-cell gap after wide chars appears in Ghostty too. |
| 6 | Resize | **Pass**: `top` redraws cleanly; `tput` follows (127×40 → 80×21 → 127×40). |
| 7 | Throughput | **seq passes, cat fails.** In release, `seq 1 2000000` takes 3.67s against Ghostty's 2.24s (1.6×), and the 20MB colored `cat` takes 1.71s against 0.28s (**6.1×**, bar 3×). Ctrl+C during a 100M-line flood reaches the prompt within about 20ms of the key. |
| 8 | Footprint (release) | Idle: 156 MiB (app 30, WebContent 98, GPU 18, Networking 6, zsh 4) at 0.0% CPU. During a flood: 282 MiB at 282% CPU (app 147%, WebContent 135%). Idle after the flood: 239 MiB. |

### What the checks found and fixed

- **The PTY inherited the launcher's environment.** Started from a Claude Code shell,
  zsh got `EDITOR=vi` and silently switched to vi keys (Option+B looked broken). It
  also got Ghostty's `TERMINFO` and `CLAUDE_CODE_*` session variables, which
  `claude attach` would act on in slice 2. The PTY now starts from an allowlist
  (`HOME USER LOGNAME SHELL TMPDIR LANG SSH_AUTH_SOCK`) plus launchd's base `PATH`, so
  a dev launch matches a Finder launch. **Rejected:** a denylist of known-bad
  variables, which misses the next one.
- **A page reload orphaned the shell.** Vite's full reload skips React cleanup, and
  the reader thread then blocked in `wait()`. PTYs are now killed on
  `PageLoadEvent::Started`. That's fine for one window; chapter 2's pool must scope
  it per window.
- **macOS PTY reads return about 1KB**, so a 20MB `cat` was about 20,000 Channel
  messages and ran at 7MB/s. A sender thread now drains queued chunks into one
  message of up to 256KB, which cut `cat` from 2.81s to 1.93s (dev build).
- **What didn't help:** an 8MB in-flight window (1.84s), a release build (1.71s), and
  1MB messages with 256KB acks (1.71s). With IPC messages no longer the limit, the
  remaining cost is xterm.js parsing and rendering inside WebKit, spread over the app
  process (custom-protocol fetches) and WebContent.

### Two acceptance bars amended

- **Item 7: bulk `cat` is recorded, not gated.** Oscillate's panes run Claude's TUI,
  which streams a few hundred bytes at a time and redraws about 10–20KB per screen,
  far below the roughly 12MB/s ceiling. Claude Code also collapses long tool output.
  Responsiveness (Ctrl+C in about 20ms, typing, `seq`) passed. A new item 14 checks
  the real workload: a long streaming turn, side by side with Ghostty.
  - **Rejected:** keeping the 3× bar and counting it as the one allowed unfixable
    item, which would spend the go/no-go's tolerance on a workload Oscillate doesn't
    have.
  - **Rejected:** measuring raw xterm.js speed first. It could only confirm the
    ceiling, not change the decision.
- **Item 1: Oscillate may add at most 0.75s from window to shell** (0.59s measured).
  "Prompt within 1s" was unmeetable: the author's login zsh takes 1.37s in any
  terminal.
  - **Rejected:** spawning the shell from Rust before the page loads. That saves about
    0.5s of cold start, but chapter 2 attaches on click, so cold start matters little.
  - **Rejected:** dropping the startup bar entirely.

## 2026-09-25 — Planning MVP 1: what the fact-finding changed

The five decisions below were settled in conversation. Planning the work turned up six
facts, and two of them changed the scope.

### Workspace trust is per folder and not inherited

A throwaway `claude --bg` in a new git repo under `~/Github Repos`, which is itself
trusted, failed before starting:

```
Workspace not trusted. Run `claude` in <dir> once and accept the trust prompt, then retry.
```

So every repo the app has never seen needs a one-time interactive trust step. The
new-session flow (chapter 3) detects this error and opens a PTY running interactive
`claude` in that repo, then retries `--bg` with the prompt it kept. **Oscillate never
writes the trust flag in `~/.claude.json` itself.** That file belongs to Claude Code, and
a hand-set flag would skip the dialog the flag exists to record.

### Badges: PR link only, through one fail-soft adapter — supersedes part of the MVP 1 scope

The MVP 1 entry below picks "branch + PR badges". It turns out neither has a supported
source:

- `claude agents --json` documents `id, cwd, kind, startedAt, state, pid, status,
  waitingFor, sessionId, name`. There is no branch, worktree or PR field.
- A background session's `cwd` stays the repo root after Claude moves it into a
  worktree. `ade5c70a` opened clipped PRs #42–46 from a worktree and still reports
  `cwd: .../clipped`. That makes `cwd` safe for grouping by repo, and useless for the
  branch.
- PR links exist only in `~/.claude/jobs/<id>/state.json` under
  `children[] {id, href, kind: "pr"}`. The docs call that file "not a stable interface".

**Chosen:** a clickable `#N` per session, read by one adapter (`pr_links.rs`). If
anything fails to parse, there is no badge and one log line; nothing else is affected.
Branch names and check-status colors move to MVP 2.
**Rejected:** full badges from `gh pr view` + `git worktree list`, which add GitHub
polling and a fuzzy worktree-to-session match. Deferring badges entirely, because the
link alone is cheap and useful.

### Every attach costs a recap

The docs say that on attach, "Claude posts a short recap of what happened while you were
away". That is a model call. Detaching and reattaching on every sidebar click would be
noisy and spend usage, so **each opened session keeps its PTY alive** while the app runs.
How many to keep (the LRU cap) is still open and needs chapter 1's per-PTY memory and CPU
numbers.

### Polling is cheap

`claude agents --json --all` took 0.31s cold, then 0.13s and 0.13s. A 2s poll is fine.
The `~/.claude/sessions` and `~/.claude/jobs` directories are watched only as a
"re-poll now" trigger, never parsed.

### Tauri e2e works on macOS, but not through `tauri-driver`

Apple ships no WebDriver for WKWebView, so plain `tauri-driver` is Linux/Windows only.
WebdriverIO's `@wdio/tauri-service` embeds a WebDriver server inside the app and supports
macOS. That is the harness for chapter 2 onward, driven against a fake `claude` so tests
never touch real sessions or quota.

### Notification clicks need more than the official plugin

`@tauri-apps/plugin-notification` (2.3.x) supports actions on mobile only (issue
plugins-workspace #2150), so a desktop notification can't open the session it's about.
Options for chapter 4's `/decide`: the community `tauri-plugin-notifications`, or a
native `UNUserNotificationCenter` delegate through `objc2`.

### How the work is broken up

Borrowed from clipped and the vault: MVP 1 is four chapters, each opened by `/decide`
writing a `PLAN-<chapter>.md` head with measurable acceptance criteria, and each cut into
slices so a bug has one origin. Chapter 1 is a go/no-go on the terminal itself, because
every other chapter assumes it holds. The roadmap is in `BACKLOG.md`.

Sources: [agent view docs](https://code.claude.com/docs/en/agent-view),
[Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/),
[notification onclick issue](https://github.com/tauri-apps/plugins-workspace/issues/2150).

## 2026-09-25 — What is in MVP 1?

**Chosen:** the core loop, plus three extras.

- Core: a Tauri `.app` launched from the Dock or Spotlight. It resolves `claude` through a
  login shell, because Finder-launched apps don't inherit the nvm PATH.
- Core: a sidebar polling `claude agents --json --all` about every 2s (~130ms per call,
  measured). A file-watch on `~/.claude/sessions` and `~/.claude/jobs` is used only as a
  "re-poll now" trigger; the app never parses those files.
- Core: click a session to run `claude attach <id>` in an xterm.js pane. **Each opened
  session keeps its PTY alive** while the app runs, because every attach makes Claude
  post a recap (a model call). Detaching and reattaching on each click would be noisy
  and cost money.
- Core: interactive terminal-tab sessions are listed dimmed, with a "run /bg to open here"
  hint.
- Core: a "+" on each repo group opens a prompt box that runs `claude --bg` in that repo.
- Extras: macOS notifications (needs you / finished / failed; clicking one opens that
  session), stop/remove from a context menu (`claude stop` / `claude rm`, showing rm's
  worktree-safety refusals verbatim), and branch + PR badges per session.
- **The first task is a spike:** `claude attach` inside xterm.js in a Tauri window.
  Verify ← and Ctrl+Z detach, Option-as-Meta, mouse-wheel scrolling, and fullscreen
  rendering. If the terminal feels worse than iTerm, nothing else matters.

**Rejected:**
- Keyboard switching (Cmd+1–9, Cmd+N, Cmd+[ / ]): deferred to MVP 2. Nice to have, but
  not needed to prove the loop.

**Still open:** how many live PTYs to keep before detaching the least recently used one.
Decide after the spike shows each attach's memory and CPU cost.

## 2026-09-25 — How is the window organized across repos?

**Chosen:** one window, one sidebar, with repos as collapsible groups and sessions nested
under each. Grouping comes from each session's `cwd`. A session that needs you in any
repo is always visible.

**Rejected:**
- A window per repo: tidier, but a blocked session in another repo is out of sight,
  which is the problem Oscillate exists to solve.
- A repo switcher at the top of the sidebar: same problem, only partly offset by badges.

**Still open:** nothing.

## 2026-09-25 — Terminal UI or a message-thread chat UI?

**Chosen:** terminal first. MVP 1 hosts the real Claude Code TUI through `claude attach`,
so permissions, questions, plan approval, slash commands and interrupts all work with no
extra code. MVP 2 adds a **read-only thread view** per session, toggled against the
terminal. It renders `~/.claude/projects/<repo>/<session-id>.jsonl`: assistant text is
raw markdown, and tool calls are structured (file, old/new text, command, output).
That allows custom formatting (highlighted code, collapsible tool calls, real diffs),
and it works for terminal-tab sessions too.

**Rejected:**
- Both views in MVP 1: more work up front, and it makes the transcript format a day-one
  dependency. That format is not a documented contract.
- Chat-first over headless `stream-json` (the Agent SDK transport): full control of
  rendering, but the app would own the processes (reversing the daemon decision below),
  and Oscillate would have to rebuild permissions, questions, plan approval and slash
  commands. The TUI gets those for free and keeps gaining features.

**Still open:** whether a composer box in the thread view can send plain replies, and
whether building on the undocumented transcript format is an acceptable risk. Revisit
at MVP 2.

## 2026-09-25 — Which stack?

**Chosen:** Rust + Tauri 2, with xterm.js in the webview and `portable-pty` on the Rust
side. The sidebar and terminal pane are TypeScript. This is a common path: several
open-source terminals (tauri-terminal, tauri-plugin-pty, Terminon, Volt) are built this
way, and xterm.js is the terminal inside VS Code, so Claude Code's TUI is known to work
in it.

**Rejected:**
- Go + Wails + `creack/pty`: the same architecture with far fewer examples, so more of
  the terminal wiring would be solved from scratch.
- Rust native (GPUI or egui + `alacritty_terminal`): the best feel and performance, but
  much more work before the first usable build. A candidate for a later rewrite if
  xterm.js proves the bottleneck.
- Swift + SwiftTerm / libghostty (what cmux uses): the most Mac-native, but outside the
  Go/Rust preference.

**Still open:** nothing.

## 2026-09-25 — Where do sessions live, and who owns them?

**Chosen:** Oscillate is a thin client over Claude Code's own supervisor daemon (the
engine behind `claude agents`). The daemon runs every background session, so sessions
survive the app quitting, sleep and auto-updates. Oscillate only lists them
(`claude agents --json --all`, documented as the supported interface for other
programs) and hosts `claude attach <id>`. New sessions start from the app with
`claude --bg`. A session started in a normal terminal tab appears in the sidebar with
live status but can't be attached (its TTY belongs to that tab) until you run `/bg` in
it.

Consequences accepted with this choice:
- Agent view is a **research preview**. Build only on the CLI (`agents --json`, `attach`,
  `--bg`, `logs`, `stop`, `rm`); the docs say `~/.claude/jobs/*` is not stable.
- Background sessions move into `.claude/worktrees/` before editing, and commit and push
  their branch. That is Claude Code's behavior, not Oscillate's. Turn it off per repo
  with `worktree.bgIsolation: "none"`.
- The daemon parks sessions that finished and have been unattached for about an hour.
  The sidebar must distinguish "paused" from "live".

**Rejected:**
- Replace `claude` with a shell alias that always runs `--bg` then `attach`: every session
  would be attachable, but it changes how every terminal behaves, for a gap `/bg` already
  covers.
- The app owns the processes (like Conductor or Claude Squad): full control, but sessions
  die when the app quits unless tmux is added, and it rebuilds what the daemon already
  does.

**Still open:** nothing.
