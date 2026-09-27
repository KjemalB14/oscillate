# Plan: Chapter 2 — Every session, one click away

## The question

The slices are in `BACKLOG.md`. Four things in them were undecided, and each changes
what slice 1 or slice 3 builds:

- how the resolver's ~1s login-shell lookup is cached;
- what Oscillate does when ← turns a pane into agent view, which can attach the same
  PTY to another session (invariant 3);
- which directory `claude attach` runs in;
- the LRU cap on live attached PTYs.

## Chosen, and why

- **The resolver is cached in memory and warmed at launch, and it re-resolves once on
  failure.**
  - The first call starts on a background thread as the app launches, so the window
    never waits on `$SHELL -lic`. The first poll and the first attach wait for it
    instead.
  - When spawning the cached `claude` fails because the binary is gone (ENOENT, or
    exit 127), the cache is cleared and the lookup runs once more. That covers an nvm
    switch or a reinstall without restarting the app.
  - `OSCILLATE_CLAUDE_BIN` bypasses the shell entirely, as it does today (invariant 4).
- **← counts as a detach.**
  - Rust watches each live attach PTY's child process: its argv, read with a sysctl
    about every 250ms.
  - When the child has become `claude agents`, Rust kills it. The pane then shows
    "Detached — click to reattach", exactly as after Ctrl+Z, and the session keeps
    running.
  - Agent view never lives long enough for anyone to pick a session in it, so the
    PTY's record of its session stays true and invariant 3 holds.
  - Slice 3 starts by confirming the mechanism: a real `exec` (same pid) or a spawned
    child. Either way, detection covers the PTY's whole process tree.
- **Attach runs in the session's own `cwd`**, the one `claude agents --json` reports.
  - A background session only starts in a trusted folder (`NOTES.md`, *Workspace
    trust*), so agent view opened by ← starts there without a trust prompt.
  - The detector then never kills a process sitting at a trust prompt, which the
    `~/.nvm` incident forbids (`NOTES.md`, chapter 1 slice 2).
  - If that directory no longer exists, the pane refuses with a message. It does not
    fall back to `$HOME`.
- **The LRU cap is 6 live attached PTYs, held to a measured budget.**
  - Opening a seventh detaches the least recently viewed pane, and clicking that pane
    again costs one recap. The visible pane is never evicted.
  - Estimate from chapter 1: 6 × ~65 MiB of `claude attach`, plus a base of ~150 MiB,
    plus the unmeasured cost of each xterm instance: roughly 600–700 MiB in all.
  - The budget is 1 GiB total and 20% of one core with 6 panes idle. If slice 3
    measures over it, the cap drops; the budget does not rise.
  - WebKit caps live WebGL contexts at 16 per page. Six panes stay well under that,
    but if the budget fails, the first lever is dropping the WebGL renderer in hidden
    panes.
- **Clipped's e2e discipline is ported, with the gate moved from push to merge**
  (decided 2026-09-26, at the start of slice 2).
  - **`e2e-author` writes every spec.** It's a subagent that writes specs from this
    file's acceptance criteria and never reads `src/` or `src-tauri/src/`. The agent
    that writes the code can't write its test, because a test written that way can
    agree with the code's own misreading.
  - **A spec lock enforces it.** A PreToolUse hook refuses spec writes from every
    agent but `e2e-author`. It's clipped's `e2e-spec-lock.sh` and its cases file,
    adapted to WDIO's spec paths. It refuses only when a spec is the *target* of a
    write, never when a spec is merely named.
  - **The gate guards `git merge` into `main`,** because there's no remote to push
    to. It keeps clipped's three answers:
    - Docs-only changes are allowed.
    - App code changed with no spec, and no commit trailer `E2E: none — <why>`, is
      refused.
    - Otherwise the suite runs, unless this exact code already passed it.
  - The gate judges the checkout the command runs in, not `$CLAUDE_PROJECT_DIR`,
    which let a worktree push through in clipped.
  - **A slice with specs spans two sessions,** because an agent defined mid-session
    can't be dispatched in that session:
    - Session A builds the harness, the agent, the lock, the gate and the feature, on
      the slice branch.
    - Session B starts with the agent loaded. `e2e-author` writes the specs from the
      criteria quoted verbatim, finding things through the app's accessibility tree,
      never the source. Then come the break tests, then the merge.
  - **A spec counts only once a break turns it red.** Break the rule where every
    path meets, then each path's own entry point. In clipped, a spec that passed with
    the shared root intact still missed a whole path.

## Rejected

- **A resolver cached once per launch and never cleared.** Simplest, but an nvm switch
  that removes the old path would need an app restart, with no hint why attach fails.
- **A resolver re-run on a TTL.** It catches a PATH change that causes no failure, but
  N is arbitrary, and it costs a login shell over and over for a change that almost
  never happens.
- **A resolver persisted to the app's data dir.** It saves ~1s off the first sidebar
  paint, but a stale PATH would be handed to any daemon that `claude attach` starts,
  and every background session inherits it.
- **Reattaching the same session at once on ←.** ← would be a no-op, but every stray ←
  would cost a recap (a model call) and a flicker.
- **Swallowing ← in the frontend.** ← also moves the cursor in Claude's prompt, and
  Oscillate can't tell when the input is empty, so editing would break.
- **Letting agent view run and tracking which session it attaches.** There's no
  supported source for that (`agents --json` has no client field), so the PTY's record
  would be a guess, and invariant 3 could break.
- **Attaching in `$HOME`, as chapter 1 did.** Agent view asks for trust there, and the
  detector would then kill a process at the trust prompt.
- **Falling back to `$HOME` when the session's `cwd` is gone.** It recreates that trust
  prompt, for a session whose repo has been deleted anyway.
- **A cap of 4.** Safe on any measurement, but with five or more parallel sessions,
  ordinary switching would keep costing recaps.
- **A cap of 8.** Fewer recaps, but an estimated ~850 MiB and ~24% of a core at idle,
  before the xterm cost is even known.
- **No cap.** No recap is ever spent on eviction, but memory and CPU grow with every
  session opened since launch.
- **The coding session writing its own specs** (decided 2026-09-26). It's cheaper,
  but a spec written that way can share the code's misreading, and a break test only
  proves the spec can go red, not that it read the criterion right.
- **An inline general-purpose subagent as the author.** It could be used this session,
  but it has no stable `agent_type`, so the lock couldn't tell it from any other
  subagent.
- **The single-author rule in `CLAUDE.md`, with no lock.** An instruction is what a
  session forgets.
- **A push gate, as in clipped.** There is no remote, so it would never fire.
- **No gate, only an instruction to run the suite before merging.** Same reason as the
  lock.
- **Gating every commit on `main`.** Docs-only commits would pay the triage each time,
  and slices land on `main` by merge anyway.
- **Specs first, then the sidebar.** The specs would come before the code, but the
  author would have to guess accessible names that don't exist yet, or the PLAN would
  have to fix them first, which amounts to writing the UI in prose.

## Still open

- **Whether ← is a real `exec` or a spawned child.** Confirmed at the start of slice 3.
  It changes how detection finds the process, not the decision.
- **The xterm instance's own cost in WebContent.** Measured in slice 3. It can lower
  the cap, never raise the budget.

## Acceptance criteria

**Status:** slice 1 shipped. Items 1–8 pass (`NOTES.md`, *Chapter 2, slice 1*).
Slice 2 shipped 2026-09-27: items 9–12 pass under `npm run e2e`, with specs by
`e2e-author`, each proved red by a break (`NOTES.md`, *Chapter 2, slice 2, session B*).
The load path (`sessions_snapshot`) is covered only incidentally, which is noted there.
Slices 3–4 are not started.

Slice 1 is checked by `cargo test` against fixture JSON and a fake `claude`. Slices 2
and 3 use the e2e harness where it can drive the scenario, and otherwise the running
app with `drive-window`, `ps`/`lsof` and `measure-footprint`. Slice 4 is checked by
hand. Results go in `NOTES.md` under *Verified in the running app*.

### Slice 1: the session model

1. **The resolver runs the login shell once.** After warm-up, 100 lookups spawn it 0
   more times. With `OSCILLATE_CLAUDE_BIN` set, it is never spawned.
2. **It re-resolves once on failure.** When the cached binary disappears, the next
   spawn triggers exactly 1 lookup. It then succeeds, or returns the "`claude` not
   found" error; it never loops.
3. **Warm-up doesn't block the window.** With a fake shell lookup that takes 3s, the
   window still appears on time.
4. **The poll is serialized.** With a fake `claude agents` that takes 3s, at most 1
   poll is ever in flight. With a fast fake, the poll runs every 2s ± 0.2s.
5. **The file-watch only triggers a re-poll.** Touching a file in the watched
   `sessions/` or `jobs/` directory (a temp dir in tests) re-polls within 300ms, and
   no file content is read. A burst of 20 touches causes at most 2 polls.
6. **The diff is quiet when nothing changed.** Two identical polls emit
   `sessions-changed` once, and one changed field emits it once more.
7. **The state mapping is total.** Fixtures cover all seven UI states. An unknown or
   `null` `state` (interactive entries report `null` today) and a missing optional
   field (`waitingFor`, `pid`, `status`) map to a defined value without a panic.
8. **A failed poll keeps the last good list.** When the fake exits non-zero or prints
   garbage, no `sessions-changed` is emitted, one error is logged, and the next good
   poll recovers.

### Slice 2: the sidebar

9. Sessions are grouped by `cwd` basename. Two repos with the same basename show a
   disambiguating parent segment. Groups collapse and show their counts.
10. Each session shows a state dot, its name and `waitingFor`. Terminal-tab sessions
    are dimmed, with "run /bg to open here". With no sessions, the empty state shows.
11. A change in the fake `claude`'s output shows in the sidebar within 2.5s, or within
    0.5s of a touch in the watched directory.
12. The WDIO + `@wdio/tauri-service` harness runs items 9–11 green against the fake
    `claude`, with a single command.

### Slice 3: click to attach, with a PTY pool

13. **Attach runs in the session's `cwd`.** `lsof -p <attach pid>` shows that
    directory. With the directory removed, the click shows a message and spawns
    nothing.
14. **Switching never reattaches.** Clicking A → B → A starts no new `claude attach`
    process (the pids are unchanged), and no new recap appears in A.
15. **← detaches.** The pane shows "Detached — click to reattach" within 500ms of
    agent view appearing, in 10 out of 10 tries. Afterwards no agent-view process is
    left under Oscillate, and the session is still listed with its state unchanged.
16. **Ctrl+Z detaches, and a click reattaches** with exactly 1 new attach process.
17. **Invariant 3 holds under stress.** Over a scripted run of 50 rapid clicks across
    3 sessions, including ←, `ps` never shows more than 1 `claude attach <id>` for
    any id.
18. **A session that vanishes from the list closes its PTY** within 2.5s.
19. **Quitting leaves no attach behind.** Within 1s of quit, 0 `claude attach`
    processes remain, and every session is still listed by `claude agents --json`.
20. **LRU.** Opening a seventh session leaves exactly 6 attach processes, and the one
    closed is the least recently viewed, never the visible one.
21. **The budget holds.** Six idle attached panes use ≤ 1 GiB total and ≤ 20% of one
    core (`measure-footprint`, averaged over 60s). Record the xterm instance's own
    cost. If this fails, the cap drops and the item is re-run.
22. **A dead pane is silent.** After its PTY exits, mouse moves, clicks, wheel, focus
    changes and keys send 0 bytes (checked with the keylogging fake).

### Slice 4: ship to the Dock

23. `Oscillate.app` sits in `/Applications` with an icon, and `codesign -dv` reports
    an ad-hoc signature.
24. Launched from Finder, the sidebar lists the same sessions as
    `claude agents --json --all` within 2s of the window appearing, and a click
    attaches one. If that attach starts the daemon, the daemon's PATH is the login
    shell's, not the base PATH.

---
<!-- agreed 2026-09-25. Implementation below. -->

## Slice 2: implementation (session A, 2026-09-26)

- **Rust.**
  - `sessions_snapshot` returns `null` until the first good poll, so the page can
    tell "not known yet" from "no sessions".
  - `OSCILLATE_CLAUDE_DIR` moves the watched directory, for tests only.
  - A cargo feature `e2e` compiles in `tauri-plugin-wdio` and
    `tauri-plugin-wdio-webdriver`. `src-tauri/tauri.e2e.conf.json` adds
    `withGlobalTauri` and the `wdio:default` capability inline, so the shipped
    capability file never names them.
- **Frontend.**
  - `src/sessions.ts` has `useSessions()`, which subscribes before it asks for the
    snapshot.
  - `src/groups.ts` groups by `cwd`, sorted by label, adding parent segments until
    labels are unique, with sessions newest first.
  - `src/Sidebar.tsx` renders it accessibly: a `navigation "Sessions"`, a `region`
    per group, a header `button` with `aria-expanded`, and the count. Each state dot
    has `role=img` and names its state. A terminal-tab row has `aria-disabled` and the
    hint.
  - `@wdio/tauri-plugin` is imported only when `VITE_E2E` is set.
- **Harness** (`e2e/README.md`):
  - one app for the whole run;
  - a TS port of the fake `claude` and a temp watched directory;
  - `show()` / `nextPoll()`;
  - a one-line summary and `brief.md`;
  - `e2e:snapshot` for the author;
  - `harness.check.ts` (4 checks, green).
- **Discipline** (`.claude/`):
  - `e2e-author`;
  - the spec lock (19 cases);
  - the merge gate (12 cases).
- **Session B:**
  1. Start the session **from this directory**.
  2. Dispatch `e2e-author` with items 9, 10 and 11 quoted verbatim.
  3. Break the app to prove each spec can go red:
     - Item 9: `groupSessions`, where every path meets, then the disambiguation alone.
     - Items 10 and 11: the `sessions-changed` listener, then the watch trigger.
     - The load path: `sessions_snapshot`.
  4. Commit, then run `npm run e2e` on a clean tree, which records it green (item 12).
  5. Merge through the gate.
