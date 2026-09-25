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

1. The window opens to the user's login shell (`$SHELL -l`, in `$HOME`) with a prompt
   within 1s of the window appearing. `echo $TERM $COLORTERM` prints
   `xterm-256color truecolor`.
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
7. **Throughput.** The scripted flood (`seq 1 2000000`, then `cat` of a fixed 20MB
   file) finishes within 3× Ghostty's time. During `seq 1 100000000`, the window stays
   responsive, and Ctrl+C returns to the prompt within 1s.
8. **Footprint recorded.** RSS for the app process, the WebKit WebContent process and
   the shell is recorded, along with CPU% for an idle PTY averaged over 10s. This is
   recorded, not gated.

### Slice 2: `claude attach <id>`

9. ← on an empty prompt detaches, and so does Ctrl+Z. The PTY exits and the pane says
   so.
10. Ctrl+C interrupts a running turn once. It does not double-fire or detach.
11. The mouse wheel scrolls Claude's fullscreen view.
12. Items 2–6 hold again inside Claude's TUI.
13. **Footprint per attached PTY recorded**, idle and during a streaming turn. This is
    the input to chapter 2's LRU cap.

**The chapter passes** if items 1–13 hold, or fewer than two are unfixable. Otherwise the
go/no-go reopens the stack.

---
<!-- agreed 2026-09-25. Implementation below. -->
