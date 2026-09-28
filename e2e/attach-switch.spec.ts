/**
 * PLAN-sessions.md, Chapter 2 slice 3, acceptance item 14, quoted verbatim:
 *
 * "Switching never reattaches. Clicking A → B → A starts no new `claude attach`
 * process (the pids are unchanged), and no new recap appears in A."
 *
 * The fake has no recap of its own: with the real `claude`, a recap is posted only
 * when a client attaches, so its equivalent here is that A's attach is never started
 * a second time -- `fake.attaches(A)` must hold exactly one entry, at the same pid,
 * across the whole A → B → A sequence. That is asserted alongside the pid claim
 * itself, corroborated two ways: the fake's own log (`fake.attaches`) and the OS
 * (`fake.running().attach`, a live `ps`).
 *
 * Confirmed live (not from src) that each attached session's pane is
 * `section[aria-label="<id> terminal"]`, and that WDIO's `isDisplayed()` correctly
 * tells the currently-shown one from a pooled, not-currently-shown one (the pool keeps
 * both mounted; only one is displayed). That is used here to prove the clicks actually
 * switched -- "switching" has to be real for "never reattaches" to be a meaningful claim,
 * not a test of three clicks on the one row that never moved.
 *
 * Fresh ids and repo names, unique to this spec, since one app serves the whole suite.
 */
import { attachable, fake, show } from "./helpers/app.js";

function rowContaining(text: string) {
  return $(`//*[contains(text(),"${text}")]/..`);
}

function pane(id: string) {
  return $(`section[aria-label="${id} terminal"]`);
}

/** Waits for the row to actually be there (the sidebar re-renders asynchronously
 * after `show()` resolves), then clicks it. */
async function clickRow(text: string): Promise<void> {
  const row = rowContaining(text);
  await row.waitForExist({ timeoutMsg: `row "${text}" never appeared in the sidebar` });
  await row.waitForClickable({ timeoutMsg: `row "${text}" never became clickable` });
  await row.click();
}

describe("switching never reattaches (item 14)", () => {
  it("shows the clicked session's terminal after each click, A then B then A", async () => {
    const idA = "swtchA1";
    const idB = "swtchB1";
    await show([attachable(idA, { repo: "swtchrepoA1" }), attachable(idB, { repo: "swtchrepoB1" })]);

    await clickRow(idA);
    await browser.waitUntil(async () => fake.attaches(idA).length > 0, { timeout: 3000 });
    await expect(pane(idA)).toBeDisplayed();

    await clickRow(idB);
    await browser.waitUntil(async () => fake.attaches(idB).length > 0, { timeout: 3000 });
    await expect(pane(idB)).toBeDisplayed();
    await expect(pane(idA)).not.toBeDisplayed();

    await clickRow(idA);
    await browser.waitUntil(async () => pane(idA).isDisplayed(), {
      timeoutMsg: "A's pane never came back to the front after clicking it a second time",
    });
    await expect(pane(idB)).not.toBeDisplayed();
  });

  it("starts no new attach process for A across A → B → A: the pid is unchanged, and no new recap", async () => {
    const idA = "swtchA2";
    const idB = "swtchB2";
    await show([attachable(idA, { repo: "swtchrepoA2" }), attachable(idB, { repo: "swtchrepoB2" })]);

    await clickRow(idA);
    await browser.waitUntil(async () => fake.attaches(idA).length > 0, { timeout: 3000 });
    const firstPid = fake.attaches(idA)[0].pid;
    expect(fake.running().attach.get(idA)).toEqual([firstPid]);

    await clickRow(idB);
    await browser.waitUntil(async () => fake.attaches(idB).length > 0, { timeout: 3000 });

    await clickRow(idA);
    await browser.waitUntil(async () => pane(idA).isDisplayed(), {
      timeoutMsg: "clicking A again never brought its pane back",
    });
    // Give a reattach every chance to have shown up in the log or in `ps` before
    // asserting its absence.
    await browser.pause(500);

    // No new recap: exactly the one attach for A across the whole sequence.
    expect(fake.attaches(idA)).toHaveLength(1);
    expect(fake.attaches(idA)[0].pid).toBe(firstPid);
    // The pids are unchanged: the OS still shows exactly that one pid alive for A.
    expect(fake.running().attach.get(idA)).toEqual([firstPid]);
  });
});
