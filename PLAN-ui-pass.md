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
- **The glass shows through the terminal.** xterm's background is the theme's color at
  about 80% alpha, with `allowTransparency`, like the author's Ghostty at 0.75. Chrome
  surfaces are translucent tints over the same glass.
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
  the see-through terminal the author uses in Ghostty.
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
   composited over both black and white. *(script, exits non-zero on a failure)*
3. In each mode, the terminal's options set the foreground, the background (the
   theme's color at about 80% alpha), the cursor, the selection, and all 16 ANSI
   colors. *(unit check on the theme function)* Claude's diff colors and dim text read
   clearly in both modes. *(hand)*
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
not the terminal's tint. Over glass, that will be a visible strip.
