/**
 * PLAN-sessions.md, Chapter 2 slice 3, acceptance item 15, quoted verbatim:
 *
 * "← detaches. The pane shows "Detached — click to reattach" within 500ms of agent
 * view appearing, in 10 out of 10 tries. Afterwards no agent-view process is left
 * under Oscillate, and the session is still listed with its state unchanged."
 *
 * Confirmed live (not from src): the fake's attach execs `claude agents` in the same
 * pid on ← (`fake.agentViews()` gets a new pid, matching the attach pid), and the
 * message is a plain `<button class="pane-status">Detached — click to reattach</button>`
 * (found with `button*=Detached`, not a bare `*=`, which the README warns only ever
 * matches an `<a>`). Clicking that button reattaches with a fresh pid every time,
 * exactly what "10 tries" needs -- a stale pid would mean a try that never left agent
 * view. Also confirmed live: by the time the message shows, the prior agent-view
 * process is already gone (`fake.running().agentView` no longer holds it), well inside
 * the window this test allows before its own final check.
 *
 * `press()` is called with no click into the terminal first: a click on the row (or on
 * the Detached message) must hand the keyboard to the pane by itself, and `press()`
 * throws if no terminal has focus, which is the right failure if that regresses.
 *
 * Each try's latency is timed from the moment `fake.agentViews()` first grows (agent
 * view "appearing"), polled every 10ms, to the moment the message exists. A failure
 * throws the full array of the ten latencies, so it says how late, and which tries.
 * The press-to-appear gap (not itself part of item 15's claim) is also recorded and
 * flagged if any try takes more than ~2s, since keys typed mid-attach are now held and
 * sent once the pane is live.
 */
import { attachable, fake, press, show } from "./helpers/app.js";

function rowContaining(text: string) {
  return $(`//*[contains(text(),"${text}")]/..`);
}

function detachButton() {
  return $("button*=Detached");
}

describe('← detaches: shows "Detached — click to reattach" in time, then cleans up (item 15)', () => {
  it("shows the message within 500ms of agent view appearing, 10 out of 10 tries; then no agent-view process remains and the session's state is unchanged", async () => {
    const id = "larrow1";
    await show([attachable(id, { repo: "larrowrepo1" })]);

    const row = rowContaining(id);
    const dot = row.$('[role="img"]');
    await row.waitForExist();
    const initialState = await dot.getAttribute("aria-label");

    const latencies: number[] = [];
    const pressToAppear: number[] = [];
    let previousPid: number | null = null;

    for (let attempt = 1; attempt <= 10; attempt++) {
      // (Re)attach: the first try clicks the sidebar row; every later try clicks the
      // "Detached" message left by the previous try's ←. Either way, a fresh pid is
      // required -- a stale one would mean this attempt reused a prior attach.
      const beforeAttaches = fake.attaches(id).length;
      if (attempt === 1) {
        await row.waitForClickable();
        await row.click();
      } else {
        await detachButton().waitForClickable();
        await detachButton().click();
      }
      await browser.waitUntil(async () => fake.attaches(id).length > beforeAttaches, {
        timeout: 3000,
        timeoutMsg: `try ${attempt}: no new attach after (re)attaching`,
      });
      const pid = fake.attaches(id)[fake.attaches(id).length - 1].pid;
      if (previousPid !== null && pid === previousPid) {
        throw new Error(`try ${attempt}: reattach reused pid ${pid} instead of starting a fresh one`);
      }
      previousPid = pid;

      // No click into the terminal: a click on the row (or on the Detached message)
      // must hand the keyboard to the pane on its own -- a user never has to click
      // into the terminal before typing. `press()` throws when no terminal has focus,
      // which is exactly the right failure here: an app that left focus elsewhere.
      //
      // Time from the press to agent view appearing, and separately from agent view
      // appearing to the message existing. The outer `waitUntil` timeout is this
      // test's own patience for the whole transition (keys typed while still
      // attaching are now held and sent once live, so this can take a moment under a
      // busy suite) -- generous, and not what item 15's 500ms budgets: that is
      // measured strictly between `appearAt` and `shownAt`, asserted below.
      const beforeAgentViews = fake.agentViews().length;
      let appearAt: number | null = null;
      let shownAt: number | null = null;
      const pressAt = Date.now();
      await press("ArrowLeft");
      await browser.waitUntil(
        async () => {
          if (appearAt === null && fake.agentViews().length > beforeAgentViews) appearAt = Date.now();
          if (appearAt !== null && (await detachButton().isExisting())) {
            shownAt = Date.now();
            return true;
          }
          return false;
        },
        {
          timeout: 8000,
          interval: 10,
          timeoutMsg:
            appearAt === null
              ? `try ${attempt}: agent view never appeared after ←`
              : `try ${attempt}: agent view appeared but the "Detached" message never showed`,
        },
      );
      pressToAppear.push(appearAt! - pressAt);
      latencies.push(shownAt! - appearAt!);
    }

    // Not part of item 15's own 500ms claim, but flagged separately: keys are now
    // held and sent once the pane is live, so press-to-appear should stay well under
    // 2s; a try that doesn't is an app problem, not load, and is reported as such.
    const slowToAppear = pressToAppear.map((ms, i) => ({ try: i + 1, ms })).filter((t) => t.ms > 2000);
    if (slowToAppear.length > 0) {
      throw new Error(
        `press-to-appear over ~2s: ${JSON.stringify(slowToAppear)} (all ten: ${JSON.stringify(pressToAppear)})`,
      );
    }

    const late = latencies.map((ms, i) => ({ try: i + 1, ms })).filter((t) => t.ms >= 500);
    if (late.length > 0) {
      throw new Error(`tries at or over 500ms: ${JSON.stringify(late)} (all ten: ${JSON.stringify(latencies)})`);
    }
    expect(latencies).toHaveLength(10);
    console.log(
      `item 15: press-to-appear ${JSON.stringify(pressToAppear)}, appear-to-message ${JSON.stringify(latencies)}`,
    );

    // No agent-view process is left under Oscillate: every pid `fake.agentViews()`
    // ever logged for this run must now be dead, not just the last one.
    const everyAgentViewPid = fake.agentViews();
    await browser.waitUntil(
      () => {
        const alive = fake.running().agentView;
        return everyAgentViewPid.every((p) => !alive.includes(p));
      },
      { timeoutMsg: "an agent-view process is still alive after the ten tries" },
    );

    // The session is still listed, with its state unchanged (the fixture's own
    // `claude agents --json` state never changed; only the pane's attach state did).
    await expect(row).toBeExisting();
    await expect(dot).toHaveAttribute("aria-label", initialState ?? "");
  });
});
