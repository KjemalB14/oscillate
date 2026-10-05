# Plan: Chapter 5 — The UI pass

## The question

MVP 1 works, and the app looks like a plain source list beside a terminal. The author
wants it to look and feel like zeron while daily use and MVP 2's `/decide` carry on
(`NOTES.md`, *The UI pass, from zeron*). The undecided parts were:
- how big the chapter is;
- which appearance and palette it has;
- whether glass is used, and how;
- which fonts it uses;
- what a row shows, and what its time measures;
- what the title bar holds;
- which shortcuts it owns;
- whether repo groups get avatars;
- in what order it lands.

## Chosen, and why

- **The whole UI pass is one chapter, in five slices.** It runs from tokens through the
  new surfaces. The author wanted the full payoff, not just a first look.
- **Light and dark, following macOS** (`prefers-color-scheme`). The author's Ghostty
  runs Gruvbox Light, so dark-only wouldn't fit them, and light-only wouldn't be zeron.
- **Zeron-style neutral palettes, which we write ourselves.** They're a cool monochrome
  ramp in each mode, with our own 16 ANSI colors tuned to it. The palette is defined
  as **semantic roles**: ground, raised, hover, selected, hairline, text, muted, faint,
  the five states, and the terminal's fg, bg, cursor, selection and ANSI16. So a later
  theme catalog can swap in whole variants, as zeron's theme system does
  (`BACKLOG.md` → *A themes tab*).
- **Liquid Glass, through our own objc2 module.** `NSGlassEffectView` (macOS 26, a
  private API) sits behind the whole window, which makes the window transparent and
  turns on `macOSPrivateApi`. It's a small Rust module, as `notifications.rs` is. If
  the class is missing or fails, the window is opaque in the ground color, and one line
  is logged. The app is ad-hoc signed and never goes to the App Store, so a private API
  costs only the risk that a macOS update breaks it, and the fallback covers that.
- **The glass shows through the terminal, on xterm's DOM renderer, if it is fast enough**
  (re-decided 2026-10-04, after the spike). Chrome surfaces are translucent tints over
  the same glass.
  - **A speed gate comes first.** Fixed bytes are replayed straight into a pane with
    `term.write` under each renderer: a recorded long streaming Claude turn, plus
    `bench-flood`'s `seq` and `cat` payloads. The DOM renderer must drain the Claude turn
    within 2× of WebGL with no visible stall, and criterion 22 must hold with it.
    `seq` and `cat` are recorded, not gated, as chapter 1 recorded `cat`.
  - **If it fails, the terminal is opaque on WebGL beside the glass chrome.** That's
    the end of it for this chapter. There's no third renderer attempt.
  - **The renderer follows transparency.** One switch, as `TERMINAL_ALPHA` already
    drives `allowTransparency`: a translucent terminal uses DOM, and an opaque one
    (glass off, or the fallback) keeps WebGL, with its speed and correct dim.
  - **Truecolor dim is fixed in our own CSS, not in xterm.** The DOM renderer halves
    palette colors for SGR 2, but writes RGB foregrounds inline, undimmed, and
    `xterm.css` pins `.xterm-dim` at `opacity: 1 !important`. One rule in our CSS dims
    `.xterm-dim` spans that have an inline color and no background, so palette colors
    aren't dimmed twice and backgrounds never are.
  - **A minimal repro of the WebGL bug** (a translucent light background drawn flat
    white, dim text at about 7%) is written as a standalone page. The author files it
    upstream. WebGL comes back for the translucent terminal only if upstream fixes it.
- **The alphas come from the glass, measured, not from pure black and white.** The
  glass's darkest and lightest are sampled in each mode, with the window over a black
  field and over a white field. Those replace pure black and white as `check-theme`'s
  backdrops, and each surface gets the lowest alpha that passes over them.
  - **The terminal's bar:** the theme's foreground ≥ 4.5:1 over those backdrops, and
    Claude's light-mode dim status line no fainter than in the opaque terminal (176 on
    251, as in Ghostty).
  - **If that floor sits well above 55%** (the look the spike saw), the palette's text,
    muted and state colors move further from the ground to buy it down. They stop at
    55%, or where the ramp stops reading as zeron's, whichever comes first.
- **Geist for the chrome and JetBrains Mono for the terminal, both bundled** (OFL).
  JetBrains Mono is what the author uses in Ghostty. Today the app only gets it because
  it's installed in `~/Library/Fonts`.
- **Rows have two lines and don't show the repo.**
  - Line 1 is the state indicator, the name, and a relative time, right-aligned.
  - Line 2 is `waitingFor` or the state's words, with the PR chip on the right.
  - The group header already names the repo.
  - A selected row is a filled card with 8px corners.
  - Every `role`, `aria-label` and visible string that `e2e/` selects on stays.
- **The row's time is last activity: `updatedAt` from the job's `state.json`.**
  - `pr_links.rs` already reads that file on every poll, so there's no new read.
  - It shows as `now`, `Nm`, `Nh` or `Nd`, re-rendered each minute.
  - Any miss means no time, logged once per session as PR misses are.
  - **This widens invariant 2's exception** from "PR links" to "PR links and
    `updatedAt`", and must still fail soft. `CLAUDE.md` changes in slice 3.
- **The state indicator moves the way zeron's does.** Working is a 3×3 cell grid with a
  750ms phase wave. Needs you is the amber dot breathing slowly. Done, failed, stopped
  and paused are static dots. Everything is still under `prefers-reduced-motion`. The
  dot keeps its `role="img"` and `aria-label`.
- **Group headers are a repo avatar, the name, then the count**, with the name in the
  text color. The chevron and "+" show on hover.
  - **The avatar is the GitHub owner image.** The origin URL comes from reading the
    repo's own git config file (a worktree's `.git` file is followed to its common dir).
    No `git` process is started.
  - It's fetched once from `https://github.com/<owner>.png` and cached in the app data
    dir, so a relaunch never refetches it.
  - Any miss (no remote, not GitHub, offline, a bad image) shows a folder glyph, logged
    once per repo.
  - **This is the app's one unprompted outbound request.** `CLAUDE.md` says so in
    slice 3. An e2e override points the base URL at a local server.
- **The title bar is unified:** `titleBarStyle: "Overlay"` with a hidden title.
  - The traffic lights sit inset over the sidebar, then the sidebar toggle.
  - The pane header shows the selected session's name, its repo muted, its state, and
    its PR chip. The rest is `data-tauri-drag-region`. With nothing selected, the header
    is empty.
  - The bottom `pane-status` bar stays only for an ended session's reattach.
  - **No back/forward.**
- **The sidebar collapses and resizes.** It runs 208–400px, defaults to 256, and its
  width and collapsed state persist in the app data dir. Changes ease over 200ms. A
  double-click on the edge resets it.
- **One motion catalog, defined once as CSS variables** (zeron's inventory §1.12):
  - `menu-in`: 140ms, scale .96 → 1, translateY −2.
  - `dialog-in`: 180ms.
  - `fade-in`: 500ms `cubic-bezier(0.16,1,0.3,1)`.
  - `fade-quick`: 150ms.
  - Size changes: 200ms ease-out.

  Every duration is 0 under reduced motion. The row menu, the PR menu, the remove
  confirm, the palette and the canvas use it, and each sits on one frosted surface
  (`backdrop-filter`, a hairline, a soft shadow). **Rows never move.**
- **A new-session canvas in the main area replaces the sidebar box.**
  - It's a composer pill on the empty pane: prompt, permission mode, and a repo picker.
  - "+" on a group preselects that repo. ⌘N preselects the selected session's repo,
    else the last one used.
  - Submitting runs `claude --bg` exactly as `newsession.rs` does today, and selects
    the new session. The trust flow is unchanged.
  - With nothing selected, the pane shows the canvas.
- **A ⌘K palette over the sidebar's own rows.** It filters by name or repo, and Enter
  opens a session as a row click does. Its actions are New session, Add repo, Toggle
  sidebar, and Stop on the selected session (live only, as in the row menu).
- **One keymap, which takes over *Keyboard switching*.**
  - ⌃⌘S toggles the sidebar (the macOS convention), ⌘K opens the palette, and ⌘N opens
    the canvas.
  - ⌘1–9 open the Nth openable row in visual order, skipping collapsed groups and
    terminal-tab rows. ⌘[ and ⌘] step to the previous and next one.
  - The keys work while the terminal has focus, and never reach the PTY.
- **Five slices, in this order, each one branch and one merge through the e2e gate:**
  1. **Look:** the tokens in both modes, the fonts, the terminal themes, and thin
     scrollbars with edge fades.
  2. **Chrome:** Liquid Glass, the overlay title bar and header, and sidebar collapse
     and resize.
  3. **Rows:** two-line rows, the indicator, `updatedAt`, group headers, and avatars.
  4. **Motion:** the catalog and frosted popovers.
  5. **Surfaces:** the canvas, ⌘K, and the keymap.

  Each builds on the surfaces before it.

## Rejected

- **Look only, or look plus rows plus motion, as this chapter.** These are smaller and
  conflict with nothing. The author wanted the whole pass in one chapter.
- **Dark only, zeron-style.** It would be half the token work, but the author works in a
  light terminal.
- **Light only, Gruvbox-ish.** It would match Ghostty, but leave zeron's look behind.
- **Gruvbox Light and Dark as the palette**, and **neutral chrome around a Gruvbox
  terminal.** The author wants zeron's look now, and a well-known-themes tab later.
  Gruvbox comes back as one of that tab's variants.
- **Classic vibrancy** (Tauri's `windowEffects`, `NSVisualEffectView`). It's a public API
  with no new code, but it's the pre-Tahoe look, and it needs the same transparency
  anyway.
- **`tauri-plugin-liquid-glass`.** It's a third-party dependency on a private API, the
  trade chapter 4 rejected for notifications.
- **CSS-only frost.** It's safe, but the desktop never shows through.
- **A glass sidebar beside an opaque terminal.** It's safer for contrast, but it isn't
  the see-through terminal the author uses in Ghostty. *(Re-weighed 2026-10-04 with the
  spike's evidence. It's still not the first choice, but it's now the fallback if the
  DOM renderer fails its speed gate.)*
- **Chasing the WebGL bug before choosing** (2026-10-04). It would keep WebGL's speed if
  the bug is ours, but its cost is open-ended, and it may end in an upstream wait. The
  repro is still written, for upstream.
- **Patching xterm's pinned beta WebGL addon in place.** Every bump would need it
  re-checked (`NOTES.md`, *Slice 2's glass spike*).
- **Timing DOM with chapter 1's bars against Ghostty** (2026-10-04). Panes run only
  `claude attach` now, so `bench-flood` would need a dev-only shell pane, which is
  outside invariant 1's spawn list. **Judging speed by hand only** leaves no number to compare
  against later.
- **The DOM renderer everywhere** (2026-10-04). It's one path to test, but the opaque
  fallback would pay DOM's cost for nothing.
- **Leaving DOM's truecolor dim undimmed** (2026-10-04). Claude's status line would lose
  its hierarchy.
- **Contrast over pure black and white at the new alphas** (2026-10-04). At 55%, 33
  pairs fail. Passing it keeps the sidebar near today's 90–94%, where the spike found
  the glass barely there. **55% by eye, measured only over the window color**, gives the
  look but no guarantee over a bright or busy desktop.
- **Accepting a high floor, or going back to `/decide`, if the measured floor is far
  above 55%** (2026-10-04). Moving the palette keeps both the guarantee and the look,
  within the zeron ramp.
- **Terminal opacity as a setting now.** It would pull a settings surface into this
  chapter. It goes with the themes tab.
- **Geist Mono in the terminal.** It's zeron's pair, but it changes the face the author
  reads all day.
- **SF Pro and SF Mono.** These are native, with nothing bundled, but they're the least
  zeron-like.
- **Zeron's three-line row.** Its `repo` line repeats the group header on every row.
- **A one-line row with the detail on hover.** It hides `waitingFor`, which is the
  point of a needs-you row.
- **The time as the last state change the app saw.** It resets at every launch, and
  says nothing for quiet sessions.
- **The time as age since `startedAt`.** A revived month-old job reads `now`, and a
  busy three-day session reads `3d`.
- **No time on rows.** It loses how stale a row is at a glance.
- **A pulsing dot only**, and **a spinner ring.** They're simpler, but not zeron's
  language.
- **Zeron's full title-bar cluster** (back/forward and "+"). It needs a navigation
  history model that this chapter would have to invent.
- **Traffic lights only in the title bar.** It's the look without the use. The session's
  name would live only in the sidebar.
- **Only the keys the new UI needs**, and **zeron's ⌘S for the sidebar.** The first
  leaves the switching keys to be chosen again later. The second isn't the macOS sidebar
  convention.
- **A folder glyph only, with no avatars.** It keeps the app local-only, but the author
  wants avatars, so the fetch is bounded instead: once per repo, cached, failing soft.
- **Glass first**, and **surfaces first**, as slice orders. Glass first leaves slice 1
  looking unfinished on its own. Surfaces first restyles the new components twice.
- **Carried over from chapter 4 and `NOTES.md`:** zeron's attention sort and its
  view-transition re-sorts (rows stay still); the message rail, transcript bubbles and
  diff sidebar (they belong to MVP 2's thread view); and a branch on rows (it's not in
  `claude agents --json`, and it stays in *Branch name and PR status colors*).

## Still open

- **Whether `NSGlassEffectView` composes with a WKWebView** that has a transparent
  background, and whether xterm's WebGL renderer draws a translucent background
  correctly. Slice 2 finds out first. If it fails, the fallback is opaque, and the
  chapter comes back to `/decide`. It doesn't silently switch to vibrancy.
  - **Half of it is answered (2026-10-04, slice 1's hand items).** WebGL draws a
    translucent background once the color is hex. But under `allowTransparency` it
    draws dim (SGR 2) glyphs at about 7% instead of 50%, and Claude's status line
    vanishes in light mode. The DOM renderer reads but doesn't dim, and costs
    speed. So the terminal is opaque until slice 2 finds dim text that reads in a
    translucent terminal: a WebGL fix, or the DOM renderer timed with
    `bench-flood`. If neither works, the see-through terminal comes back to
    `/decide`, and the glass can still sit behind the chrome.
  - **Answered (2026-10-04, slice 2's spike and `/decide`).** The glass composes. The
    terminal goes see-through on the DOM renderer behind a speed gate, else it stays
    opaque (*Chosen*, *The glass shows through the terminal*).
- **Whether the avatar fetch needs a user-visible switch.** It's left out until daily
  use asks for one.
- **The exact token values.** Slice 1 picks them against criterion 2's script.

## Acceptance criteria

Each one is checked by e2e (`e2e-author` writes the spec), by `cargo test`, by a
script, or by hand in the release app from a foreground `claude` in Ghostty.

**Slice 1 — Look**
1. Switching macOS between Light and Dark restyles the chrome and the terminal within
   1s. There's no reload, and every open PTY survives. Screenshots in both modes are the
   record. *(hand)*
2. A committed script reads the tokens for both modes and reports every text/surface
   pair. Primary text is ≥ 4.5:1 and muted text ≥ 3:1. Each translucent surface is
   composited over the glass's measured darkest and lightest in that mode *(amended
   2026-10-04: was pure black and white)*. *(script, exits non-zero on a failure)*
3. In each mode, the terminal's options set the foreground, the background (the
   theme's color at `TERMINAL_ALPHA`), the cursor, the selection, and all 16 ANSI
   colors. *(unit check on the theme function)* Claude's diff colors and dim text read
   clearly in both modes. *(hand)* *(Amended 2026-10-04: the alpha is the measured floor
   from slice 2, or 1 if the DOM renderer fails its gate. It was "about 80%".)*
4. Geist and JetBrains Mono load from the app's own bundle. `document.fonts` reports
   both loaded from the app's URL, and the release bundle contains both files. *(e2e +
   hand)*
5. The existing e2e suite passes with no spec changes. *(e2e)*

**Slice 2 — Chrome**
6. On macOS 26, the wallpaper shows blurred through the sidebar and through the tinted
   terminal. The traffic lights sit inset over the sidebar. *(hand, screenshot)*
7. With the glass forced off (an env switch), the window is opaque in the ground color,
   and stderr has exactly one line about it. *(e2e or hand)*
8. The header names the selected session (name, repo, state, PR chip), and is empty with
   nothing selected. Dragging its empty space moves the window. *(e2e for the content,
   hand for the drag)*
9. The sidebar's width persists across a relaunch, and stays within 208–400px. A
   double-click on its edge resets it to 256. ⌃⌘S collapses and restores it. The
   terminal refits after each change: its cols match the PTY's. *(e2e)*
10. Quit and window close are still refused while a trust pane runs. *(existing e2e +
    hand)*

*Added 2026-10-04 by the terminal's `/decide`. They're numbered after 22 so nothing
above is renumbered.*

23. **The speed gate.** A committed script replays a recorded long streaming Claude
    turn into a pane under each renderer. DOM drains it within 2× of WebGL's time, with
    no visible stall. `seq` and `cat` are timed and recorded, not gated. Criterion 22
    holds with DOM. *(script + hand)* If it fails, the terminal is opaque on WebGL
    beside the glass, and 24 and 25 don't apply.
24. With a translucent terminal, the pane uses the DOM renderer. With the glass off
    (`OSCILLATE_GLASS=off`), the terminal is opaque and on WebGL. *(e2e)*
25. On the DOM renderer, SGR 2 dims truecolor text: Claude's light-mode status line is
    no fainter than in the opaque terminal (176 on 251), and a dimmed palette color
    isn't dimmed twice. *(e2e on computed color + hand)*
26. `check-theme`'s backdrops are the measured glass values, recorded with how they
    were sampled. Every surface's alpha is the lowest that passes over them, or 55% if
    55% passes. The terminal's foreground is ≥ 4.5:1 over them. *(script)*
27. A minimal standalone repro of the WebGL bug draws a translucent light background
    flat white, and dim text at about 7%, in WebKit. It's ready for the author to file.
    *(hand)*

**Slice 3 — Rows**
11. A row's line 1 is the indicator, the name and the time. Line 2 is `waitingFor` or
    the state's words, plus the PR chip. The repo isn't on the row. *(e2e)*
12. The time comes from `state.json`'s `updatedAt`. It reads `now` under a minute,
    then `Nm`, `Nh` and `Nd`, and updates within 60s. A missing or bad `updatedAt` shows
    no time, and logs once per session. *(cargo test + e2e with the fake)*
13. Working shows the moving cell grid, and needs you breathes. Under reduced motion,
    both are still. *(e2e on computed animation state + hand)*
14. A repo with a GitHub origin shows its owner's avatar, fetched once and cached in the
    app data dir. A relaunch makes no request. No remote, a non-GitHub remote, offline,
    or a bad image each show the folder glyph, logged once per repo. *(e2e against a
    local avatar server + cargo test for the config parse, including a worktree)*
15. Rows still never move. `sidebar-order.spec.ts` passes unchanged. *(e2e)*

**Slice 4 — Motion**
16. The row menu, the PR menu, the remove confirm and the new-session box enter with
    the catalog's timings, read from CSS variables defined in one place. Under reduced
    motion, every duration is 0. *(e2e on computed styles)*
17. Each float has a backdrop blur, a hairline and a shadow, and reads clearly in both
    modes over a busy wallpaper. *(hand)*

**Slice 5 — Surfaces**
18. "+" on a group opens the canvas with that repo selected. ⌘N opens it with the
    selected session's repo, else the last one used. Submitting runs `claude --bg` with
    the prompt and mode, and selects the new session. An untrusted repo opens the trust
    pane as today. *(e2e; `new-session` and `trust-pane` specs updated by `e2e-author`)*
19. With nothing selected, the pane shows the canvas. *(e2e)*
20. ⌘K opens the palette. Typing filters the sessions by name or repo, and Enter opens
    the highlighted one exactly as a row click does. The actions work: New session, Add
    repo, Toggle sidebar, and Stop on a live selected session. *(e2e)*
21. ⌘1–9 open the Nth openable row in visual order, and ⌘[ / ⌘] step through them,
    including while the terminal has focus. The fake's attach logs none of those
    keystrokes. *(e2e)*

**Across the chapter**
22. With glass, animations and 6 open panes, the app stays within chapter 2's budget:
    ≤ 893 MiB total, and ≤ 2% CPU at idle with one working indicator animating.
    *(hand, measured as in chapter 2)*

---
<!-- agreed 2026-10-04. Implementation below. -->

## Slice 1 — Look: what was built

- **`src/palette.ts` is the only place a color is named.** It holds both modes' chrome
  roles and terminal colors as pure data, with no DOM, plus `terminalTheme(mode)`. That
  gives xterm every color, with the background at `TERMINAL_ALPHA` (0.8) and
  `allowTransparency` set.
- **`src/theme.ts` writes the roles as CSS variables on `:root`** (`needsYou` →
  `--needs-you`), and rewrites them when `prefers-color-scheme` changes. It also writes
  `--font-ui` and `--font-mono`. `createTerminal` follows the same change for each live
  terminal, and its new `dispose` unsubscribes. `App.css` names no color except the
  black of shadows and the scrim. Tints are `color-mix` over a role.
- **Translucent surfaces are ready for slice 2's glass.** The sidebar is 90% (dark) or
  94% (light) over `--window`. The trust bar is a tint over the sidebar's surface, not
  bare over the window. Today the window is opaque in `--window`.
- **The fonts:**
  - Geist comes from `@fontsource-variable/geist`.
  - JetBrains Mono 2.304 is the complete static woff2 faces (regular, bold, italic,
    bold italic, with OFL) in `src/assets/fonts/jetbrains-mono/`, under its own family
    name, `JetBrains Mono Bundled`. Fontsource's subsets drop the arrows, box drawing and
    symbols Claude's TUI draws.
  - `main.tsx` awaits both faces before the first render, because xterm measures its
    cell once.
- **The sidebar scrolls in an inner `.sidebar-scroll`.** It has a thin hover scrollbar,
  and a mask fades whichever edge hides rows. The row and PR menus stay children of the
  `<nav>`, outside the mask.
- **`.claude/scripts/check-theme`** (`npm run theme:check`) is criterion 2's script and
  criterion 3's unit check. It exits 1 on any failure. Breaking `muted` and
  `TERMINAL_ALPHA` turned it red.

**Left for slice 2:** the terminal host's 6px left and 4px top padding shows the window,
not the terminal's tint. Over glass, that will be a visible strip. *(Fixed with the hand
items below while the terminal is opaque. A translucent one needs the layering in
`NOTES.md`.)*

**Slice 1's hand items (2026-10-04, `tauri dev`, driven from a `--bg` job):**
- **Item 1 failed first.** Light mode showed dark text on a black terminal. The cause
  was that xterm parses only hex and comma `rgba()`. Our `rgb(r g b / 80%)` background
  fell back to xterm's opaque black, in both modes, from the start, and so did the
  selection and scrollbar colors. `check-theme` passed, because it parsed with its own
  parser. It now fails any value xterm can't read. Turning the conversion off turned
  8 values red.
- **The dim-text bug found on the way** is in *Still open*. The terminal is now opaque:
  `TERMINAL_ALPHA = 1`, and `allowTransparency` follows it. **Criterion 3's "about 80%
  alpha" is deferred to slice 2.**
- **After the fix, item 1 passes.** Light → Dark → Light with two panes open. Each
  screenshot, taken as the switch returned, shows the chrome and the terminal in the
  new mode, with no reload. The attach pids (38596, 38694) were the same across both
  switches. The screenshots are in `~/Documents/oscillate-hand-checks/2026-10-04-slice1/`,
  outside the repo because they show session transcripts.
- **Item 3 passes in light, and is conditional in dark.**
  - Claude's diff colors read in both modes.
  - In light, the status line's dim text is #666 at 50% (176 on 251), as in Ghostty.
  - In dark, Claude's muted grays are about 1.7–1.9:1. That's because the author's
    Claude theme is `light`, so the colors were chosen for a light background
    (`BACKLOG.md`, *Claude's own grays in dark mode*).

**Slice 1's e2e (2026-10-04):**
- `e2e/fonts-bundled.spec.ts` (by `e2e-author`) passes 4 of 4. Pointing the regular
  face at a missing file turned claim 3 red (the file served 631 bytes). Claim 2
  stayed green, because the other three faces still load. It only goes red if every
  face is missing.
- The first full run was 88 passed and 2 failed: the two known reload flakes,
  `sidebar-order` item 4 and `notifications` item 3, each a 30s timeout. The question
  was whether awaiting the fonts before the first render made them worse. Running the
  two specs alone five times each failed 2 of 5 on `main`'s code and 2 of 5 on this
  branch. That's the same rate, so the slice doesn't change the flake.

## Slice 2 — the glass spike: what it proved and hasn't (2026-10-04)

Built on `slice2-chrome`:
- `src-tauri/src/glass.rs` puts an `NSGlassEffectView` (Regular, radius 0, autoresizing)
  under the webview as the content view's bottom subview.
- The window is `transparent`, with `macOSPrivateApi`.
- `glass_state` tells the page, and `data-glass="on"` stops it painting the window.
- `OSCILLATE_GLASS=off`, or a missing class, keeps the window opaque with one stderr line.
- The terminal host is now the only layer that paints the terminal's background
  (xterm's own two are made transparent).

Seen in `tauri dev` over a striped test pattern, with Stage Manager off for the shots
(screenshots in `~/Documents/oscillate-hand-checks/2026-10-04-slice2-spike/`):
- **The glass composes with the transparent WKWebView: go.** The empty pane shows the
  pattern blurred, and so does the sidebar, faintly at 90%.
- **Criterion 7 passes by hand.** With `OSCILLATE_GLASS=off`, stderr has exactly one
  glass line, and the pane is a uniform `--window` (11,11,12) over the same pattern.
- **A see-through terminal on WebGL: no-go as it stands.**
  - In dark, the pattern shows through: barely at 80%, and clearly at 55%.
  - In light, the WebGL terminal is a flat 255 white at any alpha, and dim text is at
    about 7%.
  - The DOM renderer shows the pattern through the light terminal (223–253) and reads
    dim text, undimmed.
  - Forcing the WebGL context to `premultipliedAlpha: false` changed nothing.
- **The alphas will need to come down.** The look criterion 6 describes appeared at 55%
  for both the sidebar and the terminal. `check-theme`'s contrast over black and white
  backdrops hasn't been run at those values.

**Not proved:** criterion 6 in a release build, the drag and the traffic lights (the
title bar isn't touched yet), the DOM renderer's cost (`bench-flood`), and criterion 22's
budget with the glass on.

**So the chapter goes back to `/decide`**, as *Still open* says, for the terminal only.
The glass behind the chrome works. The question is what the terminal does:
- the DOM renderer, timed by `bench-flood`;
- an opaque terminal beside glass chrome, which this PLAN rejected (*A glass sidebar
  beside an opaque terminal*), now with evidence;
- or a fix to xterm's WebGL transparency, first as a minimal repro for upstream.

**Decided (2026-10-04, `/decide`):** *Chosen* → *The glass shows through the terminal*,
and criteria 23–27. The order of the rest of slice 2:
1. The speed gate (23). Its verdict picks DOM or the opaque terminal.
2. The measured backdrops and the alphas (26, then 2 and 3), with the palette moved if
   the floor is high.
3. The renderer switch and the dim rule (24, 25), only if 23 passed.
4. The WebGL repro (27).
5. The overlay title bar, the header, and sidebar collapse and resize (8–9).

## Slice 2 — the speed gate: built, not run on a real turn (2026-10-04)

- **Built:** `npm run e2e:speed` (`e2e/speed.check.ts`, page side `src/bench.ts`, e2e
  builds only) and `.claude/scripts/scrub-recording`. `createTerminal(host, { alpha })`
  now picks the renderer from the alpha (criterion 24's switch). `TERMINAL_ALPHA` is
  still 1, so nothing ships differently.
- **Proved on a synthetic turn:** the pipeline runs, and a DOM renderer slowed by
  120 ms a frame turns it red (2.10×, 132 ms gaps). The floods were at parity:
  `seq` 795/764 ms and `cat` 310/275 ms (WebGL/DOM).
- **Not proved:** criterion 23 itself. The author waived recording a real turn and moved
  on to the chrome. **The terminal stays opaque on WebGL** until the gate runs on a real
  turn: record one as the script's `--help` says, write `e2e/fixtures/claude-turn.json`,
  and run `npm run e2e:speed`. Criteria 24–27 wait on it. Criterion 22 with DOM isn't
  measured either.

## Slice 2 — the chrome: what was built and proved (2026-10-04)

**Built:**
- `titleBarStyle: "Overlay"` with a hidden title. The traffic lights are at
  `{ x: 16, y: 23 }`, which centers them in the sidebar's 40px strip beside the toggle.
- `src/PaneHeader.tsx` shows the name, the repo, the state and the PR chips. Its empty
  space is a `data-tauri-drag-region`.
- `layout.rs` keeps `layout.json` (the width, clamped to 208–400, and collapsed) beside
  `repos.json`.
- The sidebar's edge resizes it, two clicks reset it, and ⌃⌘S or the toggle collapses
  it, with a 200ms ease that's off under reduced motion.

**Proved:**
- **Criterion 8's content** passes in `e2e/pane-header.spec.ts` (by `e2e-author`).
  Dropping the header's PR chips turned it red. **The drag passed by hand:** a CGEvent
  drag on the header's empty space moved the dev window by (+100, +50), and back.
- **Criterion 9** passes in `e2e/sidebar-resize.spec.ts` (by `e2e-author`, 9 tests,
  including ⌃⌘S never reaching the PTY). Dropping the page's clamp turned it red.
- **Criterion 6's traffic lights** are inset over the sidebar, in a screenshot of the
  dev window (`~/Documents/oscillate-hand-checks/2026-10-04-slice2-chrome/`).
- **Criterion 7** passed by hand in the spike.
- **Criterion 10:** the existing trust-pane specs pass in the full suite (103/103).

**Not proved:**
- Criterion 6's see-through terminal: it's parked with the speed gate.
- Criterion 6's glass in a release build: it's checked once installed.
- Criterion 10 by hand.
- Light mode by hand: the header and the strip use the existing roles, which
  `check-theme` measures.
- Criterion 22's budget with the glass on.

## Slice 3 — Rows: what was built and proved (2026-10-04)

**Built:**
- **`pr_links.rs` reads `updatedAt` too**, from the file it already read. Only the form
  Claude Code writes (`2026-10-04T23:17:49.030Z`) is a time. Any other is
  `BadUpdatedAt`, a missing one is `NoUpdatedAt`, and each logs once per session.
  `Session.updatedAt` carries it to the page.
- **`src/ago.ts`** turns it into `now`, `Nm`, `Nh` or `Nd`. `useNow` re-renders every 30s
  rather than every minute, so criterion 12's "within 60s" holds with room to spare.
  Each render reads the clock afresh.
- **`StateDot`** (`Sidebar.tsx`, also in the header):
  - Working is nine cells, with a 750ms wave across the diagonals.
  - Needs you breathes over 3s, in scale and opacity, instead of the old ring.
  - **`theme.ts` mirrors Reduce motion as `data-motion="reduce"`** on the root, and
    every animation and transition in `App.css` keys off it. The two old media queries
    went.
- **Group headers** run avatar, name (text color), count. The chevron moved to the
  right end (`order: 1`), and it and the group's actions fade in on hover or focus.
- **`avatars.rs`:**
  - It walks up from the group's directory to `.git`, follows a worktree's `.git` file
    and `commondir`, and reads `[remote "origin"]`'s url.
  - It accepts only a github.com owner GitHub would allow.
  - It fetches `https://github.com/<owner>.png?size=64` once per owner per process,
    through `NSURLSession`, which follows the redirect. Only a 200 that is a PNG, JPEG,
    GIF or WebP (≤ 1 MiB) is kept, as `<data dir>/avatars/<owner>`.
  - `repo_avatar` answers only for a listed `cwd` or an added repo. A repo under the
    Claude dir is a miss (invariant 5).
- **The harness:**
  - `helpers/avatar-server.ts` is the local stand-in. The e2e build reads its base URL
    from the file `OSCILLATE_E2E_AVATAR_BASE` names, and fetches nothing without it.
  - `fake.gitRepo`, `fake.gitWorktree`, `fake.avatarCache` and `attachable({ cwd })`
    are new (`e2e/README.md`).

**Proved:**
- **Criteria 11–13** pass in `e2e/rows.spec.ts` (by `e2e-author`, 23 tests). Each break
  turned its claim red:
  - Dropping the state's words from line 2 failed 11.
  - A 120s clock failed 12's "`1m` within 60s". It also failed "a bad `updatedAt`
    replacing a good one", which read `2m` for `3m`. That showed a render measured
    against the last tick, not the current time, so `useNow` now reads the clock on
    every render.
  - Deleting the reduced-motion rule failed 13.
- **Criterion 14** passes in `e2e/avatars.spec.ts` (by `e2e-author`, 13 tests: https, scp,
  a worktree, an added repo, one request per owner, every kind of miss, and a relaunch).
  Never reading the cache failed its relaunch test.
- **The "logs once" halves of 12 and 14, and the config parse with a worktree,** are cargo
  tests (`pr_links::tests::item12_*`, `avatars::tests::item14_*`). The app's stderr
  isn't readable from e2e.
- **The real fetch:** `cargo test real_github -- --ignored` got the author's avatar from
  github.com through `NSURLSession`, and read an unknown owner as `HTTP 404`.
- **Criterion 15:** `sidebar-order.spec.ts` passes unchanged, as does every other
  existing spec in the full run.

**Not proved:**
- Criterion 13 by hand: the motion's look, and macOS's Reduce motion switch reaching
  `data-motion`.
- Criterion 14 in the installed app against real repos.
- Light mode by eye. The rows use only existing roles, which `check-theme` measures.
  The dark rows were seen in an e2e screenshot.
- Criterion 22 with a working indicator animating.

## Slice 4 — Motion: what was built and proved (2026-10-04)

**Built:**
- **`src/motion.css` is the catalog**, imported once before `App.css`:
  `--motion-menu-in` (140ms), `--motion-dialog-in` (180ms), `--motion-fade-in` (500ms),
  `--motion-fade-quick` (150ms) and `--motion-size` (200ms), with the `menu-in`,
  `dialog-in` and `fade-in` keyframes and one class per entry. Under
  `:root[data-motion="reduce"]` every duration is `0ms`. Nothing else in the CSS names a
  duration, except the state indicators' own loops, which reduced motion stops outright.
  - The sidebar's width, the chevron and the group actions now run on the catalog
    (`--motion-size`, `--motion-fade-quick`), so their per-element reduced-motion rules
    went.
- **The floats:** the row menu, the PR menu and the remove confirm enter with
  `menu-in`. The new-session box's scrim fades in over `fade-quick`, and its panel enters
  with `dialog-in`. `fade-in` waits for slice 5's canvas.
- **`.frosted` is the one surface** for those four and the quit notice: the `raised`
  tint, `backdrop-filter: blur(20px) saturate(160%)`, a hairline and a soft shadow.
  **`raised` keeps its 94–95% alpha**, so the blur barely shows until the glass alphas
  are measured (*The see-through terminal and the glass alphas*).
- The remove confirm is now a float tinted 10% `failed` over `raised`. Its Remove
  button is unfilled, because `failed` over the hover fill measured 4.06:1 in dark mode
  over white. `check-theme` measures both new surfaces.

**Proved:**
- **Criterion 16** passes in `e2e/motion.spec.ts` (by `e2e-author`, 16 tests: each
  float's keyframes and duration, a root override of `--motion-menu-in` and
  `--motion-dialog-in` reaching every float that uses them, and every duration 0 under
  reduced motion). Each break turned its claim red:
  - Hard-coding `menu-in`'s 140ms failed the three menu-in floats' override tests and
    their reduced-motion tests (6).
  - Deleting the reduced-motion block failed all six reduced-motion tests.
- `check-theme` passes with the confirm's two new surfaces.

**Not proved:**
- **Criterion 17 by hand:** each float's frost, hairline and shadow in both modes over a
  busy wallpaper. The blur is subtle at today's `raised` alpha, by design.
- The entrances' look in the release app, and macOS's Reduce motion reaching them (the
  same switch slice 3's hand item checks).
