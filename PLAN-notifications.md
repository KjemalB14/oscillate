# Plan: Chapter 4 — It tells you when it needs you

## The question

The slices are in `BACKLOG.md`. Five things in them were undecided, and each changes
what a slice builds:

- how the app posts a macOS notification and learns which one was clicked. The official
  `@tauri-apps/plugin-notification` has no desktop click (`NOTES.md`, *Planning MVP 1*),
  so the choice was the community plugin or a native delegate;
- what "not for the visible session" means once the window can be behind another app;
- whether needs you changes the sidebar's order. zeron sorts its list by attention, and
  chapter 3 froze the order;
- what a row shows when its session opened several PRs (`ade5c70a` has five);
- how much of this `npm run e2e` can check, since the e2e app is built `--no-bundle`, and
  macOS only delivers notifications to a bundled app.

## Chosen, and why

- **Notifications go through our own native delegate, not a plugin.**
  - A small Rust module on `UNUserNotificationCenter`, through `objc2-user-notifications`.
    That crate is already in `Cargo.lock` as a transitive dependency.
  - The delegate's click lands in Rust, where the transitions are detected. It tells a
    tap (`UNNotificationDefaultActionIdentifier`) from a dismissal, and only a tap opens
    anything.
  - Authorization is requested once at launch. If it's denied, nothing is shown about
    it, and the Dock badge still works.
- **What notifies: a transition into needs you, done or failed, for a session with an
  id.**
  - Transitions are detected in Rust on the poll thread, against the last mapped
    `UiState` per key. So a webview reload re-notifies nothing.
  - **The first poll after launch is the baseline**, and notifies nothing. A key first
    seen after that, already in one of the three states, counts as a transition.
  - Terminal-tab rows never notify, since a click couldn't open them. Every repo's
    sessions count, not only added ones.
  - The title is the session's name. The subtitle is the group's label. The body is
    `waitingFor` for needs you (or "Needs you" if it's empty), "Done", or "Failed". The
    sound is the system default; the author tunes it in System Settings.
  - **One notification per session.** Its identifier is the session's id, so a newer
    one replaces the older in Notification Center. Opening the session, from its row or
    from the notification, removes its delivered notification.
- **A session is visible when its pane is selected, and the window is key and not
  minimized.** Only then is its transition not notified. With Oscillate behind another
  app, even the selected session notifies.
- **A tap opens the session through the row-click path.** The app comes forward, the
  window un-minimizes, and the session is selected and attached exactly as a sidebar
  click does it, so the pool and invariant 3 hold. If the id is no longer listed, the
  app comes forward and the selection doesn't change.
- **The Dock badge counts needs-you sessions,** the visible one included, and shows
  nothing at 0. It updates on the same poll as the sidebar.
- **Rows stay still.** The notification, the Dock badge and the existing state dot carry
  the signal. Chapter 3's frozen order is untouched.
- **The PR link is the newest PR as `#N`, then `+k` for the rest.**
  - `pr_links.rs` reads `<claude dir>/jobs/<id>/state.json` (about 3 KB each) for every
    listed id, on every poll. It takes `children[]` entries with `kind: "pr"`, a
    string `id` and an `https://` `href`. The newest is the last such entry.
  - The row shows `#<id>` for the newest, and `+k` when there are k more. `#N` opens its
    `href` in the default browser. `+k` opens a small menu of the others, newest first,
    and each one opens its `href`.
  - **Every miss means no chip:** no file, unreadable, not JSON, no `children`, no
    usable entry. Each one logs one line per session and kind of miss, not one per poll.
    Nothing else in the row or the app changes. Only `https://` hrefs are ever opened.
  - It only reads. `CLAUDE.md`'s invariant 5 gets the carve-out invariant 2 already
    has, in slice 2.
- **The e2e build swaps the notifier for a log.** Under the `e2e` feature, each post,
  removal and badge change is appended to a file the harness reads, instead of reaching
  macOS. An e2e-only command feeds a tap or a dismissal for an id into the delegate's
  own handler. Real banners, real clicks, and the unfocused and minimized cases are
  checked by hand in the release app.
- **Two slices,** each one branch and one merge through the e2e gate: 1) notifications
  and the Dock badge; 2) the PR link. Chapter 4 closes MVP 1.

## Rejected

- **The community `tauri-plugin-notifications`.**
  - Its native macOS backend is a pre-release (0.5.0-rc.14) behind
    `default-features = false`, and every build gains a `swift build` step.
  - Clicks reach JS listeners only, with no Rust callback.
  - Open issue #354 (filed 2026-09-30, no fix yet) reports that a dismissal fires
    `notificationClicked`. The workaround would be its `onAction` with `"tap"`.
  - It refuses to run outside a `.app` bundle, which breaks `tauri dev`. The native
    delegate has the same constraint, but we decide how it degrades.
- **The official `@tauri-apps/plugin-notification`.** It has no desktop click, so a
  notification couldn't open its session (`NOTES.md`, *Planning MVP 1*).
- **"Visible" as selected, whatever the focus.** It's quieter, but a blocked session
  sitting behind another app would go unseen, which is the problem Oscillate exists to
  solve.
- **Sorting rows by attention, as zeron does.** It reverses chapter 3's decision that
  rows never move under the pointer.
- **A pinned "Needs you" section above the groups.** Rows wouldn't move, but a section
  that appears and disappears is more UI than the notification and Dock badge need.
- **Only the newest PR.** The others would be unreachable from the app.
- **One chip per PR.** Five chips crowd the row and squeeze the session name.
- **Notifying at launch for states already present.** Every relaunch would replay old
  news.

## Still open

- **The Dock badge's API.** Tauri 2.11's `set_badge_count` exists on macOS, but
  tauri#13905 ("setBadgeCount don't work", macOS) is open and untriaged.
  `NSDockTile`'s `badgeLabel` through objc2 is the fallback. Slice 1 picks one, and item
  10 checks it by hand.
- **A tap while the app isn't running.** The app posts nothing while it's quit, but a
  banner from an earlier run can still be tapped. That launches the app. Whether the
  delegate is set early enough to receive that tap isn't promised: if it is, the
  session opens; if not, the app just launches.
- **Whether `done` fires on every finished turn.** In chapter 3's hand checks, a session
  went `done` after its turn. If that makes notifications noisy in daily use, it goes
  in `BACKLOG.md`. It doesn't change this chapter.
- **That `children[]` is in creation order.** `ade5c70a`'s #42–46 are in order, but
  `state.json` is "not a stable interface". If it's wrong, "newest" is the wrong chip,
  and nothing breaks.
- **zeron's unseen markers and sounds** are not in this chapter. They're in
  `BACKLOG.md` → *Later*.

## Acceptance criteria

**Status:** slice 1 shipped 2026-10-01. Items 1–9 pass under `npm run e2e`
(`e2e/notifications.spec.ts`, by `e2e-author`). All 12 breaks turned red the claims they
target, two only after the spec was strengthened (`NOTES.md`, *Chapter 4, slice 1*).
**Item 10 passed by hand** on 2026-10-01 in the installed release app. The first tap
opened nothing and is unexplained; every tap after it attached
(`NOTES.md`, *Chapter 4, item 10 passed*).

Every item is checked by `npm run e2e` against the fake `claude`, unless it says it's
checked by hand or by `cargo test`. The specs come from `e2e-author`, and each is proved
red by a break. "The notifier log" is the e2e build's record of every post, removal and
badge change. Items that end in "by hand" are checked in the release app against real
`claude`, with throwaway `--permission-mode plan` sessions that are `claude rm`'d
afterwards. Results go in `NOTES.md`.

### Slice 1: notifications and the Dock badge

1. **Each transition posts once.** When the fake moves a listed session from working to
   blocked, then to done, then to failed, the notifier log has exactly one post per
   change, each within 3s of it. Each post's identifier is the id. Its title is the
   name, its subtitle is the group label, and its body is the `waitingFor`, "Done" and
   "Failed" in turn.
2. **Only those three states post.** Changes into working, paused, stopped or unknown
   post nothing within 5s. Neither does a terminal-tab entry in any state.
3. **Launch is the baseline.** With the fake listing sessions already blocked, done and
   failed, launch and `relaunch()` post nothing within 5s of the first list showing. A
   webview reload posts nothing either. A new id that first appears blocked after
   launch posts once.
4. **The visible session is quiet.** With a session's row selected and the window
   focused, its move to blocked posts nothing within 5s. Another session's move to
   blocked at the same time posts once. **By `cargo test`:** the visibility rule is
   false whenever the window isn't key or is minimized.
5. **One per session.** Two transitions of one session leave posts with the same
   identifier, so the second replaces the first. Selecting the session's row logs a
   removal of its identifier.
6. **A tap opens the session.** Feeding a tap for a listed id into the handler selects
   that row, and its pane runs exactly 1 `claude attach <id>` within 3s, with no second
   attach if it was already open. The tap logs a removal of its identifier. A tap for
   an id that isn't listed changes no selection and spawns nothing.
7. **A dismissal does nothing.** Feeding a dismissal for a listed id changes no
   selection and spawns nothing within 3s.
8. **The Dock badge counts needs you.** With 0, 1, then 3 blocked sessions in the fake,
   the logged badge is none, "1", then "3", each within 3s, whether or not one of them
   is selected. Back to 0, it's none again.
9. **Nothing under the watched Claude dir is written** over the slice's specs
   (invariant 5).
10. **By hand:** in the release app, the first launch asks for permission once. Then,
    for a throwaway plan-mode session that asks a question, with Oscillate behind
    another app:
    - a banner shows with its name and question;
    - the Dock badge shows 1;
    - tapping the banner brings Oscillate forward with that session attached.

    The same holds with the window minimized. A dismissed banner opens nothing. With
    that session selected and Oscillate in front, its next question posts no banner.

### Slice 2: the PR link

11. **Newest, plus a count.** For a fake job whose `state.json` has PR children #42–46,
    the row shows `#46` and `+4` within 3s. Clicking `#46` sends exactly that `href` to
    the opener, which a test hook answers. `+4` opens a menu of #45, #44, #43 and #42 in
    that order, and each item sends its own `href`.
12. **One PR, no count.** With a single PR child, the row shows `#N` and no `+`.
13. **Every miss is no chip.** A missing `state.json`, an empty file, invalid JSON, no
    `children`, only non-`pr` children, and a PR child whose `href` isn't `https://`,
    each show no chip. In every case the row's name, state dot and `waitingFor` match
    the same session with no `state.json`, and other rows' chips are unaffected.
14. **It follows the file.** When a fake job's `state.json` gains a PR child, the chip
    appears within 3s. When the file is deleted, the chip goes within 3s.
15. **Read only.** Over the slice's specs, the temp `OSCILLATE_CLAUDE_DIR` tree is
    unchanged by the app (invariant 5).
16. **By `cargo test`:** each kind of miss logs one line per session, and a repeat of
    the same miss logs nothing more.
17. **By hand:** in the release app, a real session with several PRs shows its newest
    as `#N` and the rest as `+k`, and `#N` opens that PR in the default browser.
    `ade5c70a` (#42–46) is one, while it's still listed.

---
<!-- agreed 2026-09-30. Implementation below. -->

## Implementation, slice 1

- **`src-tauri/src/attention.rs`** (pure, `cargo test`): `Attention::update` returns the
  notes a list's transitions make, keyed by id, with the first list as the baseline.
  `labels()` ports `src/groups.ts`'s label rule for the subtitle, `needs_you()` is the
  badge count, and `visible()` is item 4's rule.
- **`src-tauri/src/notifications.rs`:** the `Notifier`, which `lib.rs` manages before the
  poller starts. The poller's `on_change` calls `on_list` after `sessions-changed`. It has
  three sinks:
  - `MacSink`, only in a `.app`: `UNUserNotificationCenter` through objc2, an
    `OscillateNotificationDelegate` class (`willPresent` → banner, list and sound;
    `didReceive` → tap or dismiss), and authorization asked once at launch;
  - `NoSink`, in an unbundled `tauri dev`;
  - `LogSink`, in the e2e build.

  The Dock badge is Tauri's `set_badge_count`. tao implements it on macOS as
  `NSApp.dockTile.setBadgeLabel`. `respond()` is the one tap handler, shared by the
  delegate and the e2e command.
- **Commands:**
  - `set_visible_session(id)`: the page's selection, which also removes that id's
    delivered notification;
  - `e2e_notification_response(id, action)`: the e2e build only. Other builds refuse it.
- **`src/App.tsx`:** sends `selected` (or `null` for the trust pane) to Rust on every
  change, and opens `open-session` through `select`.
- **Harness:** `OSCILLATE_E2E_NOTIFY_LOG` and `OSCILLATE_E2E_FOCUS`, plus
  `fake.notifications()`, `fake.focus()`, `tapNotification()` and
  `dismissNotification()` (`e2e/README.md`).

## Implementation, slice 2

- **`src-tauri/src/pr_links.rs`:**
  - `parse`/`read` turn a `state.json` into PRs, oldest first, plus its misses: no file,
    unreadable, not JSON, no `children`, or a bad PR child (no id, or an href that isn't
    `https://`).
  - `PrLinks::attach` sets `Session.prs` on every listed id each poll, and logs each
    (session, miss) once. Ids that aren't letters and digits never become a path.
  - The poller runs it after `FirstSeen`, so a PR that appears or goes is a change.
- **`open_pr(href)`:** opens only an `https://` href that a listed session names, through
  the opener plugin. In e2e builds it's appended to `OSCILLATE_E2E_OPEN_LOG` instead.
- **`src/Sidebar.tsx`:**
  - `PrChips` shows `#N` for the newest PR and `+k` for the rest.
  - `PrMenu` lists the others newest first. It shares `FloatingMenu` with the row's
    context menu.
  - Clicks and keys on the chips never select the row.
- **Harness:** `fake.job()`, `fake.prState()`, `fake.opened()` and
  `fake.claudeDirExpected()` (`e2e/README.md`).
