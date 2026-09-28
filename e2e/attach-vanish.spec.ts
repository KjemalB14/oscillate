/**
 * PLAN-sessions.md, Chapter 2 slice 3, acceptance item 18, quoted verbatim:
 *
 * "A session that vanishes from the list closes its PTY within 2.5s."
 *
 * "Vanishes from the list" is the fake's `agents --json --all` answer no longer
 * containing it: `fake.setOut([...])` with a shorter array, not `show()` (which would
 * also `fake.touch()`). The 2.5s is timed from that `setOut` alone, with no touch, so
 * the plain 2s poll is what has to catch it -- the same allowance item 11 gives the
 * "no touch" case, for the same reason. "Closes its PTY" is checked at the OS level
 * (`fake.running().attach`), not just that the pane disappeared.
 *
 * Two sessions are attached; the one that vanishes is checked both as the pane
 * currently showing (clicked last) and as a hidden, pooled one (clicked first, then
 * covered by the other) -- and either way, the session that stays listed must keep its
 * own attach: the very same pid, still alive.
 */
import { attachable, fake, show } from "./helpers/app.js";

function rowContaining(text: string) {
  return $(`//*[contains(text(),"${text}")]/..`);
}

async function attachAndGetPid(id: string): Promise<number> {
  const before = fake.attaches(id).length;
  const row = rowContaining(id);
  await row.waitForExist();
  await row.waitForClickable();
  await row.click();
  await browser.waitUntil(async () => fake.attaches(id).length > before, {
    timeout: 3000,
    timeoutMsg: `no attach after clicking ${id}'s row`,
  });
  return fake.attaches(id)[fake.attaches(id).length - 1].pid;
}

/**
 * Attaches `idKeep` and `idGone` (clicking `clickOrder` in order, so whichever is
 * clicked last is the visible pane), then removes `idGone` from the fake's list and
 * measures how long its attach takes to close.
 */
async function runScenario(
  idKeep: string,
  idGone: string,
  clickOrder: [string, string],
  repoKeep: string,
  repoGone: string,
) {
  // The repo names must not contain either id as a substring: `rowContaining` finds a
  // row by its own text, and a group label containing an id (e.g. a repo named
  // "<id>repo") would match first and shadow the actual session row.
  const entryKeep = attachable(idKeep, { repo: repoKeep });
  const entryGone = attachable(idGone, { repo: repoGone });
  await show([entryKeep, entryGone]);

  const pids: Record<string, number> = {};
  for (const id of clickOrder) {
    pids[id] = await attachAndGetPid(id);
  }
  const keepPid = pids[idKeep];
  const gonePid = pids[idGone];

  // Sanity: both really are attached before anything vanishes.
  expect(fake.running().attach.get(idKeep)).toEqual([keepPid]);
  expect(fake.running().attach.get(idGone)).toEqual([gonePid]);

  const start = Date.now();
  fake.setOut([entryKeep]); // idGone vanishes from the list; no fake.touch()
  await browser.waitUntil(
    () => {
      const alive = fake.running().attach.get(idGone) ?? [];
      return !alive.includes(gonePid);
    },
    {
      timeout: 2500,
      interval: 25,
      timeoutMsg: `attach pid ${gonePid} (${idGone}) is still alive 2.5s after it vanished from the list`,
    },
  );
  const elapsed = Date.now() - start;
  console.log(`item 18: ${idGone}'s PTY closed ${elapsed}ms after vanishing from the list`);

  // The session that stays listed keeps its own attach: the same pid, still running.
  expect(fake.running().attach.get(idKeep)).toEqual([keepPid]);
  await expect(rowContaining(idKeep)).toBeExisting();

  // And the vanished session is gone from the sidebar too, not just its PTY.
  await expect(rowContaining(idGone)).not.toBeExisting();
}

describe("a session that vanishes from the list closes its PTY within 2.5s (item 18)", () => {
  it("closes the PTY of a hidden pane, pooled but not on screen, when it vanishes", async () => {
    // Clicked first, then covered by the other: hidden when it vanishes.
    await runScenario("vanishkeep1", "vanishgone1", ["vanishgone1", "vanishkeep1"], "repoalpha1", "repobeta1");
  });

  it("closes the PTY of the visible pane, when the one on screen vanishes", async () => {
    // Clicked last: it's the visible pane when it vanishes.
    await runScenario("vanishkeep2", "vanishgone2", ["vanishkeep2", "vanishgone2"], "repoalpha2", "repobeta2");
  });
});
