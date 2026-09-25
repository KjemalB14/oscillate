# Decisions

Newest first. Written before the work, not after.

Oscillate is a macOS app for moving between parallel Claude Code sessions: a sidebar of
every session grouped by repo, and the real Claude Code terminal UI for the one you pick.

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
