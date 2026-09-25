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
- committed and pushed;
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
`portable-pty` (`src-tauri/src/pty.rs`, `src/TerminalPane.tsx`). Its one pane attaches
to a background session through the `claude_bin()` resolver (`src-tauri/src/claude.rs`),
and all 14 acceptance items were verified against Ghostty. The verdict and what it
didn't prove are in `NOTES.md` → *Chapter 1 closed: go*. **Next: open chapter 2 with
`/decide`** (`BACKLOG.md`).

- Dev: `npm run tauri dev`. Release binary: `npx tauri build --no-bundle`.
- `OSCILLATE_ATTACH=<id>` makes the pane run `claude attach <id>`; without it, the pane
  runs a login shell.
- `@xterm/*` is pinned to 6.1.0 betas for the kitty keyboard protocol. Don't
  downgrade to 6.0: Esc Esc stops working in Claude.
- Rust lives in `~/.cargo/bin`.
- Claude can drive the window itself with `~/.claude/scripts/drive-window` (`--help`).

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
