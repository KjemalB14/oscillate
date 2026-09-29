# Plan: Chapter 3 — Start and end sessions from the app

## The question

The slices are in `BACKLOG.md`. Five things in them were undecided, and each changes
what a slice builds:

- the sidebar's row order, which chapter 3 must settle before it adds rows. Rows sort
  newest first by `startedAt`, and attaching moved them under the pointer;
- what the "+" prompt box takes besides the prompt;
- what makes the app retry `claude --bg` after the trust step, given that it may never
  kill the process sitting at the trust prompt;
- which of Stop and Remove ask for confirmation;
- which repos keep a group when they have no sessions, and how one leaves the list.

Plus how the chapter is sliced.

## Chosen, and why

- **Rows keep the `startedAt` the app first saw, for the life of the app process.**
  - Why rows moved: `startedAt` is when the session's *current process* started, not
    when the session was created. This job's `state.json` says `createdAt` 07:24, while
    `agents --json` says `startedAt` 14:15, the time of its last respawn. Attaching a
    paused or done session respawns it and moves it to the top.
  - So each row's sort key is its `startedAt` the first time the app sees its `key`.
    Rows are newest first, and the key never updates while the app runs. A new session
    goes on top of its group, and nothing moves after that. A relaunch re-derives the
    order from the current `startedAt`.
  - Only `agents --json` supplies it (invariant 2). `state.json`'s `createdAt` would
    be a stable creation time, but that file is off-limits except to the PR adapter.
  - Groups stay sorted by label, as today.
- **The "+" prompt box takes a prompt and a permission mode.**
  - A "+" sits on every repo group except *No folder*. It opens a multi-line prompt
    and a mode picker: *Default* (no flag), `plan`, `acceptEdits`, `auto`, `manual`,
    `dontAsk`. `bypassPermissions` is left out.
  - Submit runs `claude --bg [--permission-mode <m>] <prompt>` in the group's `cwd`
    through the resolver, as argv with no shell. An empty prompt can't be submitted.
  - The app parses the id from stdout and forces a re-poll. Once the id is in the
    list, the app selects it and attaches it, through chapter 2's pool. If the id isn't
    listed within 10s, the box says so and shows the id.
  - Any other failure is shown verbatim (stderr, then stdout), and the box keeps its
    prompt and mode.
- **"Add repo…" writes the app's own `repos.json`, and only added repos outlive their
  sessions.**
  - It opens a folder picker. The chosen directory is canonicalized and stored in
    `repos.json` in the app's data directory, never under `~/.claude/` (invariant 5).
  - An added repo shows as a group even with 0 sessions. It merges with the group its
    sessions already make, because both are keyed by the canonical path.
  - "Remove from list" on an added group's header drops it from `repos.json`. The group
    stays while it still has sessions. Groups that come only from sessions behave as
    they do today.
- **Trust: you accept it and exit, then the app retries once.**
  - When `--bg` fails with `Workspace not trusted`, the app opens a *trust pane*
    running interactive `claude` (no prompt) in that `cwd`, labelled
    "Accept trust, then /exit". It keeps the prompt and mode.
  - When that process exits, for whatever reason, the app retries `--bg` exactly once.
    On success it selects and attaches the session, as above. If the repo is still
    untrusted (you chose "No, exit"), it shows "Not trusted, nothing started" and keeps
    the prompt. It doesn't retry again.
  - **The app never kills the trust pane's process.** In chapter 1, a `claude` killed
    at the trust prompt left its folder marked trusted (`NOTES.md`, *An incident not to
    repeat*). So the trust pane is outside the LRU pool, the ← watch ignores it, and
    it has no close control while its process lives. Cmd+Q while it's open is refused,
    with "Answer the trust prompt first".
  - At most one trust pane at a time. A second untrusted "+" focuses the open one.
  - The app never reads or writes the trust flag in `~/.claude.json`. The only
    signals are `--bg`'s own error and the pane's exit.
- **Stop and Remove are on a row context menu, and only Remove asks for
  confirmation.**
  - Background rows get the menu. Stop shows while the session is live (working, needs
    you or paused), and Remove shows always. Terminal-tab rows get no menu, because
    they have no id.
  - Stop runs at once, since it's reversible: attach reopens the session. Remove asks
    first, in one line.
  - Either one first closes the row's PTY, if it has one, through chapter 2's drain.
    Only once no `claude attach <id>` is left does the app spawn `claude stop <id>` or
    `claude rm <id>`.
  - An `rm` refusal is shown verbatim, as selectable text. The app never passes
    `--discard-unpushed` or `--force-remove-worktree`, and it offers no button that
    would.
- **Four slices,** each one branch and one merge through the e2e gate: 1) frozen row
  order; 2) "+" and "Add repo…"; 3) the trust pane; 4) Stop and Remove. Trust has its
  own slice because it's the only one that needs a hand check against a really
  untrusted directory, and a bug there should have one origin.

## Rejected

- **Rows by name.** Stable for named sessions, but Claude names a new session after
  its first turn, so the row created in slice 2 would jump just after it appears.
- **Rows by id.** Stable across relaunches too, but meaningless: a new session lands at
  a random spot in its group.
- **Rows by live `startedAt`, as today.** Any attach of a paused or done session
  respawns it, and the list moves under the pointer between two clicks.
- **Sorting by `state.json`'s `createdAt`.** It is the true creation time, but reading
  it breaks invariant 2 for something that isn't the PR adapter.
- **A prompt box with only the prompt.** Plan mode is how careful and throwaway
  sessions are started here, and it would mean going back to the terminal.
- **Prompt, mode and name.** One more field on every start, and Claude names sessions
  itself.
- **Retrying by polling `--bg` every ~2s, and killing the trust pane on success.** One
  fewer step, but the app would kill a `claude` process on an inference, and it would
  spawn repeated `--bg` attempts.
- **Detecting accepted trust from the pane's output.** Matching Claude's rendered REPL
  breaks across versions.
- **Running the prompt in the interactive trust `claude` itself.** No retry needed,
  but the session would live in Oscillate's PTY, which breaks invariant 1.
- **Confirming both Stop and Remove.** Stopping a runaway session would cost an extra
  click, for an action attach undoes.
- **Confirming neither.** Then `rm`'s own worktree refusals would be the only guard,
  and `rm` of a clean session deletes it with no refusal.
- **A button that re-runs `rm` with the reported `--discard-unpushed` value.** It's
  one click from discarding unpushed commits. The backlog already ruled out doing that
  automatically, and a button is only a click away from automatic.
- **Remembering every repo ever seen.** You'd never re-add one, but old experiment
  directories would pile up in the sidebar.
- **Added repos with no "Remove from list".** Less UI, but leaving the list would mean
  editing `repos.json` by hand.
- **Three slices (trust folded into "+"), or two (order folded in too).** Fewer
  merges, but a bug in the trust retry or the ordering would share an origin with the
  "+" flow.

## Still open

- ~~**`claude --bg`'s exact stdout.**~~ Settled in slice 2: `backgrounded · <id>`,
  colored even into a pipe, then four dim hint lines, with empty stderr and exit 0
  (Claude Code 2.1.284). The bytes are in `src-tauri/fixtures/bg/` and
  `e2e/fixtures/bg-stdout.txt`, and the fake answers with them (`NOTES.md`,
  *Chapter 3, slice 2*).
- **The real `rm` refusal text.** It's shown verbatim, so only its exit code matters to
  the code. Slice 4 captures one against a real session with an unpushed worktree
  commit, if one can be made cheaply. Otherwise the refusal is covered by the fake only,
  and that is recorded.
- **Accepting trust needs the author's hands.** A Claude session answers every trust
  prompt with "No, exit", so it can verify item 17's "not trusted" branch against real
  `claude`, but not the accepted branch.

## Acceptance criteria

**Status:** slice 1 shipped 2026-09-28. Items 1–4 pass under `npm run e2e`
(`e2e/sidebar-order.spec.ts`, by `e2e-author`). A snapshot without sort keys turns
only item 4 red, and the other breaks cascade through all four (`NOTES.md`,
*Chapter 3, slice 1*).

Slice 2 shipped 2026-09-28. Items 5–11 pass under `npm run e2e`
(`e2e/new-session.spec.ts`, `e2e/add-repo.spec.ts`, `e2e/repos-claude-dir.spec.ts`, by
`e2e-author`), and each claim was proved red by a break. **Item 12 passed by hand**
in the reinstalled release app on 2026-09-28 (`NOTES.md`, *Chapter 3, slice 2*). Item
8's "nothing is attached" clause is held by two layers: the box never selects an unlisted
id, and `pty_spawn` refuses one. So a break proves it red only with both layers broken
(`NOTES.md`, *Chapter 3, slice 2*). Slices 3–4 aren't started.

Every item is checked by `npm run e2e` against the fake `claude`, unless it says it's
checked by hand. The specs come from `e2e-author`, and each is proved red by a break.
The fake records every invocation's argv, `cwd` and start time. Items that end in "by
hand" are checked in the release app against real `claude`, with throwaway
`--permission-mode plan` sessions that are `claude rm`'d afterwards. Results go in
`NOTES.md`.

### Slice 1: rows stay still

1. **A respawn doesn't move a row.** When the fake gives an existing row a newer
   `startedAt` than every other row, the row's position in its group is unchanged 2.5s
   later, and still unchanged after 10 more polls.
2. **A renamed row doesn't move.** When the fake changes a row's `name`, its position
   is unchanged 2.5s later.
3. **A new session goes on top.** A new key with the newest `startedAt` shows first in
   its group within 2.5s, and the other rows keep their relative order.
4. **Order is frozen for the app process, not the page.** After a webview reload, rows
   keep the order from items 1–3.

### Slice 2: a new session from the app

5. **Every group but *No folder* has a "+"**, and it opens a prompt box with a
   multi-line prompt and a mode picker offering Default, `plan`, `acceptEdits`, `auto`,
   `manual` and `dontAsk`, and nothing else.
6. **Submit spawns exactly one `--bg`.** In the group's `cwd`, argv is
   `--bg --permission-mode <m> <prompt>`, with no `--permission-mode` under Default.
   A prompt containing quotes, `$`, backticks and newlines arrives byte-exact. With an
   empty prompt, submit is disabled and nothing is spawned.
7. **The new session opens.** Within 3s of its id appearing in the list, it's the
   selected row, and its pane runs exactly 1 `claude attach <id>`.
8. **Failures are visible and keep the prompt.** A `--bg` that exits non-zero shows
   its stderr verbatim, with the prompt and mode still in the box. An id that isn't
   listed within 10s shows a message containing the id, and nothing is attached.
9. **"Add repo…" adds a group.** With the picker answered by a test hook, the chosen
   directory shows as a group with 0 sessions and a "+" within 0.5s. It's still there
   after an app relaunch. Adding the same directory twice, or through a symlink, gives
   one group. Adding a directory that already has sessions gives one group.
10. **"Remove from list" works on added groups only.** It removes a 0-session added
    group within 0.5s, and removes it from `repos.json`. On an added group with
    sessions, the group stays. Groups that come only from sessions have no such item.
11. **Nothing under the watched Claude dir is written.** Over the slice's specs, the
    temp `OSCILLATE_CLAUDE_DIR` tree is unchanged by the app (invariant 5).
12. **By hand:** "+" on `~/Github Repos` in the release app, in plan mode, starts a
    real session and shows it attached. `claude agents --json` lists it with that
    `cwd`.

### Slice 3: the trust pane

13. **Untrusted opens the trust pane.** When `--bg` fails with `Workspace not
    trusted`, a pane labelled "Accept trust, then /exit" runs exactly one interactive
    `claude` (no `--bg`, no prompt) in that `cwd`.
14. **Its exit retries once.** When the trust pane's process exits, exactly 1 more
    `--bg` is spawned, with the kept prompt and mode. When it succeeds, item 7 holds.
15. **Still untrusted stops there.** When the retry fails with `Workspace not
    trusted`, the box shows "Not trusted, nothing started" with the prompt kept, and
    no further `--bg` or trust `claude` is spawned within 10s.
16. **The app never kills the trust pane.** While it's open, 7 other sessions are
    opened (past the LRU cap), ← and Ctrl+Z are sent to other panes, and Cmd+Q is
    pressed. The trust `claude`'s pid is alive throughout, it receives no signal from
    the app, and Cmd+Q shows "Answer the trust prompt first". A second "+" on an
    untrusted repo focuses the existing pane and spawns nothing.
17. **By hand:** the "not trusted" branch against real `claude`. In a new
    `mktemp -d` git repo, "+" opens the trust pane; "No, exit" is answered; the box
    shows "Not trusted, nothing started"; no session is listed for that directory.
    The *accepted* branch is checked by the author: accept, `/exit`, and the session
    starts and attaches.

### Slice 4: Stop and Remove

18. **The menu matches the row.** A right-click on a live background row offers Stop
    and Remove. A done, failed or stopped row offers only Remove. A terminal-tab row
    has no menu.
19. **Stop closes the pane first.** On an attached row, the fake records `stop <id>`
    starting after the last `attach <id>` process has exited, and exactly 1 `stop` is
    spawned. The row shows Stopped within 2.5s, and a click afterwards starts exactly
    1 attach.
20. **Remove confirms.** Cancelling spawns nothing and leaves any pane attached.
    Confirming closes the pane first, as in item 19, then spawns exactly 1
    `rm <id>` with no other arguments. On exit 0, the row is gone within 2.5s.
21. **A refusal is shown verbatim.** When `rm` exits non-zero, its output shows
    verbatim and can be selected, the row stays, and no second `rm` is spawned. Across
    the whole e2e run, no argv contains `--discard-unpushed` or
    `--force-remove-worktree`.
22. **By hand:** Stop, then Remove, on a throwaway real session from the release app.
    It shows as stopped, then disappears from `claude agents --json --all`.

---
<!-- agreed 2026-09-28. Implementation below. -->
