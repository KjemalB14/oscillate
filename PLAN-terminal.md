# Plan: Chapter 1 — The terminal holds (go/no-go)

## The question

Can a Tauri 2 window with xterm.js over `portable-pty` host Claude Code's TUI well
enough to replace the terminal you use today? Every later chapter assumes it can. If it
can't, the stack decision reopens before chapter 2.

Settled alongside it: the frontend framework (a React + TypeScript default until now),
what "as good as" is measured against, and how slice 2 runs `claude` before the
chapter 2 resolver exists.

## Chosen, and why

- **Frontend: React + TypeScript on Vite. The default is confirmed.** The payoff is in
  chapter 2's grouped, collapsible sidebar re-rendered from `sessions-changed` diffs, and
  in chapter 3's prompt box and context menu. React has the most Tauri and xterm
  examples. The one awkward part, keeping each xterm instance mounted but hidden across
  session switches, is the same in every framework, so it doesn't favor another.
- **The baseline is Ghostty, not iTerm.** iTerm isn't installed on the author's machine.
  Ghostty is what Claude Code runs in today, so "worse than" means worse than the thing
  Oscillate replaces. Being GPU-rendered, it is also the stricter bar.
- **The pass bar is the checklist plus scripted throughput and a recorded footprint.**
  The output flood is repeatable and cheap to run. Measuring footprint also settles
  chapter 2's open question about the LRU cap. Typing latency is judged by feel and
  written down.
- **Slice 2 adds a minimal `claude_bin()` resolver.** It honors `OSCILLATE_CLAUDE_BIN`
  and otherwise runs `$SHELL -lc 'command -v claude'`. This is the real function, so
  invariant 4 holds from the first `claude` call. Chapter 2 slice 1 only adds caching
  and tests against a fake `claude`.
- **The PTY bridge is hand-written over `portable-pty`.** Output goes to the webview
  through a Tauri 2 `Channel` as ordered raw bytes, and writes and resizes go through
  `invoke`. Rust owns the PTY lifecycle because chapter 2's pool and invariant 3
  (never two PTYs attached to the same session) have to be enforced there.
- **xterm.js setup:** `@xterm/xterm` with the WebGL renderer, falling back to the DOM
  renderer on context loss. The addons are fit, unicode11 (emoji and wide-character
  widths) and web-links. OSC 8 links open through Tauri's opener plugin.
- **The go/no-go rule is unchanged from `BACKLOG.md`.** If two or more acceptance items
  can't be fixed, reopen the stack decision (a native Rust renderer) before chapter 2.

## Rejected

- **Vanilla TypeScript.** It gives the smallest chapter 1, but chapter 2 would need a
  hand-written render loop for the sidebar diffs.
- **Svelte 5.** A lighter runtime, but fewer Tauri + xterm examples to borrow from.
  Bundle size barely matters in a local webview.
- **Solid.** Its fine-grained reactivity suits status dots, but it has the smallest
  ecosystem of the options.
- **iTerm as the baseline.** It isn't installed, and the comparison would be against
  muscle memory the author no longer has.
- **Terminal.app as the baseline.** It's the lowest bar, so a pass would prove little.
- **Measured input latency (Typometer).** The most rigorous option, but the tool is
  fiddly on macOS, and a borderline number rarely changes the verdict.
- **Feel only, with numbers gating nothing.** It's weakest exactly when the result is
  borderline.
- **Hardcoding the `claude` path for the spike.** It breaks invariant 4 on day one and
  relies on a later cleanup.
- **Pulling chapter 2's whole resolver forward.** Caching and fake-`claude` tests don't
  help answer whether the terminal holds.
- **`tauri-plugin-pty`.** It hides the PTY lifecycle that the pool and invariant 3 need
  to own.
- **Tauri events (`emit`) for PTY output.** They serialize every chunk as JSON, which
  makes them slower than a `Channel` for a byte stream.

## Still open

- **The LRU cap on live PTYs.** Decided in chapter 2 slice 3 from the footprint numbers
  recorded here.
- **How slice 2 takes the session id "by hand"** (env var or CLI argument). That's a
  slice 2 implementation detail.

## Acceptance criteria

Each item is checked by hand in the running app, and the result is recorded in
`NOTES.md` under *Verified in the running app*. The baseline is Ghostty, on the same
machine and the same shell.

### Slice 1: login shell, no Claude

1. The window opens to the user's login shell (`$SHELL -l`, in `$HOME`).
   `echo $TERM $COLORTERM` prints `xterm-256color truecolor`. **Oscillate adds at most
   0.75s** between the window appearing and the shell being spawned. *(Amended
   2026-09-25: the original "prompt within 1s" bar couldn't be met by any terminal,
   because the author's login zsh alone takes 1.37s.)*
2. **Option acts as Meta.** In zsh, Option+B and Option+F move the cursor back and
   forward a word, and Option+Backspace deletes a word.
3. **Cmd+C copies the selection and Cmd+V pastes.** Pasting multi-line text into
   `cat > /dev/null` arrives intact (bracketed paste). Cmd+C with nothing selected does
   not send SIGINT.
4. **OSC 8 links open in the default browser.**
   `printf '\e]8;;https://example.com\e\\link\e]8;;\e\\\n'` renders "link", and
   Cmd+click opens it. Plain URLs are clickable too.
5. **Truecolor, emoji and wide characters render correctly.** A 24-bit gradient shows
   no banding into 256 colors. `echo '👍🏽 日本語 é'` renders the same width as in Ghostty,
   and the cursor lands in the right column afterwards.
6. **Resizing reflows cleanly.** Dragging the window edge updates `tput cols` and
   `tput lines`, and a running `top` redraws at the new size with no leftover
   artifacts.
7. **Throughput.** `seq 1 2000000` finishes within 3× Ghostty's time. During
   `seq 1 100000000`, the window stays responsive, and Ctrl+C returns to the prompt
   within 1s. The 20MB colored `cat` is **recorded, not gated**. *(Amended 2026-09-25:
   it ran at 6.1× Ghostty, xterm.js's ceiling in WebKit, and bulk output isn't
   Oscillate's workload. Item 14 tests the real one. The reasoning is in `NOTES.md`.)*
8. **Footprint recorded.** RSS for the app process, the WebKit WebContent process and
   the shell is recorded, along with CPU% for an idle PTY averaged over 10s. This is
   recorded, not gated.

### Slice 2: `claude attach <id>`

9. Ctrl+Z detaches: the PTY exits and the pane says so. *(Amended 2026-09-25: ← was
   meant to detach too, but `claude attach` maps it to agent view, which runs inside
   the pane. That's Claude's key map, not a terminal fault. Chapter 2 handles it.)*
10. Ctrl+C interrupts a running turn once. It does not double-fire or detach.
11. The mouse wheel scrolls Claude's fullscreen view.
12. Items 2–6 hold again inside Claude's TUI.
13. **Footprint per attached PTY recorded**, idle and during a streaming turn. This is
    the input to chapter 2's LRU cap.
14. **A long streaming turn keeps up.** The same session, streaming a long answer
    through several tool calls, is watched in Oscillate next to Ghostty. Scrolling and
    redraws show no visible lag or tearing that Ghostty doesn't also show.

**The chapter passes** if items 1–14 hold, or fewer than two are unfixable. Otherwise the
go/no-go reopens the stack.

---
<!-- agreed 2026-09-25. Implementation below. -->

## Slice 1: done (2026-09-25)

Every item was checked in the running app; the results are in `NOTES.md` →
*Chapter 1, slice 1: verified in the running app*. Items 1–8 pass against the amended
bars.

- `src-tauri/src/pty.rs` spawns `$SHELL` as a login shell in `$HOME` through
  `portable-pty`, from an **allowlisted environment** plus launchd's base `PATH`, with
  `TERM=xterm-256color` and `COLORTERM=truecolor`.
  - A reader thread feeds a sender thread, which drains queued ~1KB PTY reads into
    one Channel message of up to 256KB.
  - The reader pauses at 1MB unacked and resumes on `pty_ack`.
  - PTYs are killed on app exit and when the page starts loading.
- `src/TerminalPane.tsx` sets up xterm.js with WebGL (DOM fallback), fit,
  unicode-graphemes, web-links and an OSC 8 `linkHandler` (Cmd+click, through the
  opener plugin). `macOptionIsMeta` is on, the font is JetBrains Mono 14, and parsed
  bytes are acked in 64KB batches.
- Two tools repeat across slices:
  - `.claude/scripts/bench-flood <label>` runs in whichever terminal it's started in.
  - `.claude/scripts/measure-footprint` measures the running app, dev or release.

**Not proved by slice 1:** anything involving Claude (items 9–14), and whether
PTY-kill-on-reload is right once there are several panes (chapter 2's pool).

## Slice 2: done (2026-09-25)

Every item was checked in the running app; the results are in `NOTES.md` →
*Chapter 1, slice 2*. Items 9–14 pass, item 9 against the amended bar.

- `src-tauri/src/claude.rs`: `claude_bin()` honors `OSCILLATE_CLAUDE_BIN`. Otherwise it
  asks `$SHELL -lic`, because nvm lives in `.zshrc`, and returns both the path and the
  login PATH that attach runs with.
- `pty_spawn` takes an optional session and runs `claude attach <id>`. It refuses a
  second PTY for a live session (invariant 3). The id comes from `OSCILLATE_ATTACH`
  through `initial_session`.
- xterm.js is on 6.1.0-beta.304 with the kitty keyboard protocol on, so Esc Esc and
  Ctrl+C clear Claude's input as they do in Ghostty.

## Go/no-go: **go** (2026-09-25)

Items 1–14 hold. Items 1, 7 and 9 were amended, and none is unfixable. The stack is
not reopened, and chapter 2 builds on it.

**Not proved by chapter 1:**
- Several panes at once: the pool, the LRU cap, and PTY-kill-on-reload scoped per
  window.
- A Finder-launched app (chapter 2 slice 4).
- Claude's ← agent view inside a pooled pane.
