# Oscillate — working notes

Running log across sessions. `CLAUDE.md` is the authoritative *state*; `BACKLOG.md` is
what is not built yet. This file is for everything else: what was tried, what was
decided and why (including what was rejected), what a thing cost to find out, and
workflows worth repeating.

Newest entries at the top.

---

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
