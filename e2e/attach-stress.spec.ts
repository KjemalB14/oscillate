/**
 * PLAN-sessions.md, Chapter 2 slice 3, acceptance item 17, quoted verbatim:
 *
 * "Invariant 3 holds under stress. Over a scripted run of 50 rapid clicks across 3
 * sessions, including ←, `ps` never shows more than 1 `claude attach <id>` for any id."
 *
 * Invariant 3 (CLAUDE.md): "Never two PTYs attached to the same session." The script is
 * a fixed sequence of 50 steps, generated once from a seeded PRNG (`mulberry32`, fixed
 * seed) rather than `Math.random()`, so a failure names an exact, reproducible
 * sequence (printed in full on failure). Each step is either:
 * - a click on one of the 3 sessions -- on its Detached message if its own pane
 *   (`section[aria-label="<id> terminal"]`) currently shows one, otherwise on its
 *   sidebar row -- so a click always does whatever a real click on that session would:
 *   attach, reattach, or just refocus an already-live pane;
 * - a ← (`press("ArrowLeft")`) with no target: it lands wherever the terminal
 *   currently has focus, whichever session that happens to be.
 * No step waits for the app to settle first ("rapid"): each fires right after the
 * previous one's own promise resolves.
 *
 * `press()` throws when no terminal has focus (`e2e/helpers/app.ts`) -- expected here,
 * since a ← can land in the gap right after a click before the pane takes focus, or
 * while a session is mid-detach with no pane focused at all. That is treated as a
 * no-op for the step (counted, not failed): a focus gap is not itself two PTYs on one
 * session, which is the only thing this test polices.
 *
 * `ps` (`fake.running().attach`) is sampled after every step and, concurrently, on an
 * unawaited 20ms interval that runs for the whole script -- a real background sample,
 * not just between steps, since `fake.running()` shells out to `ps` and returns
 * without needing anything from the step loop. The first sample anywhere that shows
 * more than 1 pid for any id fails the test immediately, with that sample and the step
 * index reached.
 *
 * Finally, the run is checked to have actually exercised what it claims, for more than
 * one of the 3 sessions: a non-trivial number of attaches beyond the first one each
 * (reattaches), and a non-trivial number of ← detaches (`fake.agentViews()`, its pids
 * cross-checked against this run's own attach pids, since the fake's `agents pid=`
 * line carries no session id and the suite's one app may have other sessions' pids
 * logged too).
 */
import { attachable, fake, press, show } from "./helpers/app.js";

function rowContaining(text: string) {
  return $(`//*[contains(text(),"${text}")]/..`);
}

function rowXPath(id: string): string {
  return `//*[contains(text(),"${id}")]/..`;
}

function detachXPath(id: string): string {
  return `//section[@aria-label="${id} terminal"]//button[contains(text(),"Detached")]`;
}

/**
 * Clicks the first element an xpath matches via the DOM's own `.click()`, not
 * WebDriver's native click pipeline -- which waits for the element to be scrolled
 * into view and "interactable" (up to `waitforTimeout`) before every single click.
 * 50 of those add up past this test's own timeout under any load; this is instant,
 * matches "rapid" literally, and returns whether anything was there to click.
 */
async function fastClick(xpath: string): Promise<boolean> {
  return browser.execute((xp) => {
    const el = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
      .singleNodeValue as HTMLElement | null;
    if (!el) return false;
    el.click();
    return true;
  }, xpath);
}

/** Deterministic PRNG (mulberry32): same seed, same sequence, every run. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Step = { kind: "click"; id: string } | { kind: "left" };

describe("invariant 3 holds under stress (item 17)", () => {
  it("ps never shows more than 1 claude attach <id> for any id, over 50 rapid steps across 3 sessions", async function () {
    this.timeout(90_000); // 50 unwaited steps, each still a real WebDriver click or keypress
    const ids = ["stressA1", "stressB1", "stressC1"];
    await show(ids.map((id, i) => attachable(id, { repo: `stressrepo${"ABC"[i]}1` })));

    for (const id of ids) {
      await rowContaining(id).waitForExist();
    }

    // The fixed script: ~30% ←, ~70% a click on one of the 3 sessions (uniform).
    const rng = mulberry32(20260928);
    const steps: Step[] = [];
    for (let i = 0; i < 50; i++) {
      steps.push(rng() < 0.3 ? { kind: "left" } : { kind: "click", id: ids[Math.floor(rng() * ids.length)] });
    }

    let violation: { context: string; id: string; pids: number[] } | null = null;
    const checkRunning = (context: string) => {
      if (violation) return;
      for (const [id, pids] of fake.running().attach) {
        if (pids.length > 1) {
          violation = { context, id, pids: [...pids] };
          break;
        }
      }
    };

    const interval = setInterval(() => checkRunning("background poll"), 20);
    let skippedPresses = 0;
    try {
      for (let i = 0; i < steps.length; i++) {
        if (violation) break;
        const step = steps[i];
        if (step.kind === "click") {
          const clickedDetach = await fastClick(detachXPath(step.id));
          if (!clickedDetach) await fastClick(rowXPath(step.id));
        } else {
          try {
            await press("ArrowLeft");
          } catch {
            skippedPresses++;
          }
        }
        checkRunning(`after step ${i + 1} of 50: ${JSON.stringify(step)}`);
      }
    } finally {
      clearInterval(interval);
    }

    if (violation) {
      throw new Error(
        `invariant 3 violated: ${JSON.stringify(violation)}\nfull script (seed 20260928): ${JSON.stringify(steps)}`,
      );
    }

    // The run actually exercised attaches, ← detaches, and reattaches, for more than
    // one session -- not just 3 idle attaches and a lot of no-op presses.
    const mine = new Set(ids);
    const attaches = fake.attaches().filter((a) => mine.has(a.id));
    const attachesPerId = new Map<string, number>();
    for (const a of attaches) attachesPerId.set(a.id, (attachesPerId.get(a.id) ?? 0) + 1);
    const reattachedIds = [...attachesPerId.entries()].filter(([, n]) => n > 1).map(([id]) => id);

    expect(attaches.length).toBeGreaterThan(ids.length); // more than one attach each, in total
    expect(reattachedIds.length).toBeGreaterThanOrEqual(2); // more than one session reattached

    const minePids = new Set(attaches.map((a) => a.pid));
    const detachedPids = fake.agentViews().filter((p) => minePids.has(p));
    const detachedIds = new Set(attaches.filter((a) => detachedPids.includes(a.pid)).map((a) => a.id));

    expect(detachedPids.length).toBeGreaterThan(1); // a non-trivial number of ← detaches
    expect(detachedIds.size).toBeGreaterThanOrEqual(2); // for more than one session

    console.log(
      `item 17: ${attaches.length} attaches (${JSON.stringify([...attachesPerId])}), ` +
        `${detachedPids.length} ← detaches across ${detachedIds.size} sessions, ${skippedPresses} presses skipped (no focus)`,
    );
  });
});
