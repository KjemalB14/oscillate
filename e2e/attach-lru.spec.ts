/**
 * PLAN-sessions.md, Chapter 2 slice 3, acceptance item 20, quoted verbatim:
 *
 * "LRU. Opening a seventh session leaves exactly 6 attach processes, and the one
 * closed is the least recently viewed, never the visible one."
 *
 * The cap itself is from the same file's decision head: "The LRU cap is 6 live
 * attached PTYs ... Opening a seventh detaches the least recently viewed pane ... The
 * visible pane is never evicted."
 *
 * Each test attaches 6 sessions, then *revisits* some of them (a click on an
 * already-attached row -- item 14 says this starts no new process) in an order that
 * differs from the order they were opened, before opening a 7th. That makes "least
 * recently viewed" a real claim: the eviction target is derived here from the
 * revisit order, not just asserted to be whichever was opened first, and one test
 * makes the oldest-opened session also the visible one, precisely where a naive
 * open-order rule would evict it.
 *
 * `fake.running().attach` (a live `ps`) is the source of truth throughout, not
 * `fake.attaches()` (which only ever grows). Every test starts by draining the pool
 * (`show([])`, then waiting for zero live attach processes -- item 18, already proved)
 * so an earlier spec's still-closing sessions can never be mistaken for this test's
 * own, and can never count against its own 6-slot budget.
 */
import { attachable, fake, show } from "./helpers/app.js";

function rowContaining(text: string) {
  return $(`//*[contains(text(),"${text}")]/..`);
}

/** Clicks `id`'s row, expecting this to be its first-ever attach, and returns the new pid. */
async function attachNew(id: string): Promise<number> {
  const before = fake.attaches(id).length;
  const row = rowContaining(id);
  await row.waitForExist();
  await row.waitForClickable();
  await row.click();
  await browser.waitUntil(async () => fake.attaches(id).length > before, {
    timeout: 8000,
    timeoutMsg: `no new attach after clicking ${id}'s row`,
  });
  return fake.attaches(id)[fake.attaches(id).length - 1].pid;
}

/** Clicks `id`'s row again: a view, not a new attach (item 14). */
async function revisit(id: string): Promise<void> {
  const row = rowContaining(id);
  await row.waitForExist();
  await row.waitForClickable();
  await row.click();
  await browser.pause(50); // give it a moment to register as the most recent view
}

/** A clean pool: no attach process left alive by any earlier test or spec. */
async function drainPool(): Promise<void> {
  await show([]);
  await browser.waitUntil(() => fake.running().attach.size === 0, {
    timeout: 5000,
    interval: 50,
    timeoutMsg: "another test's or spec's attach processes never closed before this one could start clean",
  });
}

// Words with no substring relation to any id used here or to each other (item 18's lesson).
const REPOS = ["alfa", "bravo", "charlie", "delta", "echo", "foxtrot", "golf"];

describe("LRU: opening a seventh session leaves exactly 6 attach processes (item 20)", () => {
  it("the one closed is the least recently viewed, not simply the one opened first", async () => {
    await drainPool();
    const ids = [1, 2, 3, 4, 5, 6, 7].map((n) => `lruA${n}`);
    await show(ids.map((id, i) => attachable(id, { repo: REPOS[i] })));

    const pids: Record<string, number> = {};
    for (const id of ids.slice(0, 6)) pids[id] = await attachNew(id);
    // Opened 1..6 in order; without a revisit, 1 would be "oldest". Revisiting 2, then
    // 4, then 1 (last) makes 1 the *most* recently viewed instead, and leaves 3 as the
    // one nobody has looked at since it was opened -- the true least-recently-viewed.
    await revisit(ids[1]); // 2
    await revisit(ids[3]); // 4
    await revisit(ids[0]); // 1 (now the visible pane)

    const evictedPid = pids[ids[2]]; // 3
    pids[ids[6]] = await attachNew(ids[6]); // opening the 7th

    await browser.waitUntil(() => fake.running().attach.size === 6, {
      timeout: 8000,
      timeoutMsg: `expected exactly 6 live attach processes after opening the 7th, got ${fake.running().attach.size}`,
    });

    expect(fake.running().attach.get(ids[2]) ?? []).toEqual([]); // 3: evicted
    for (const id of [ids[0], ids[1], ids[3], ids[4], ids[5], ids[6]]) {
      expect(fake.running().attach.get(id)).toEqual([pids[id]]);
    }
    console.log(`item 20: evicted ${ids[2]} (pid ${evictedPid}), the true least-recently-viewed of the six`);
  });

  it("never evicts the visible pane, even when it is also the oldest-opened", async () => {
    await drainPool();
    const ids = [1, 2, 3, 4, 5, 6, 7].map((n) => `lruB${n}`);
    await show(ids.map((id, i) => attachable(id, { repo: REPOS[i] })));

    const pids: Record<string, number> = {};
    for (const id of ids.slice(0, 6)) pids[id] = await attachNew(id);
    // Opened 1..6 in order, so 1 is the oldest-opened *and*, after this revisit, also
    // the visible pane -- exactly where an open-order rule would evict it. Proper
    // last-viewed order instead makes 2 (never revisited) the least recently viewed.
    await revisit(ids[0]); // 1

    pids[ids[6]] = await attachNew(ids[6]); // opening the 7th

    await browser.waitUntil(() => fake.running().attach.size === 6, {
      timeout: 8000,
      timeoutMsg: `expected exactly 6 live attach processes after opening the 7th, got ${fake.running().attach.size}`,
    });

    // The oldest-opened, currently-visible session survives.
    expect(fake.running().attach.get(ids[0])).toEqual([pids[ids[0]]]);
    // The true least-recently-viewed one (2) is the one closed instead.
    expect(fake.running().attach.get(ids[1]) ?? []).toEqual([]);
    for (const id of [ids[2], ids[3], ids[4], ids[5], ids[6]]) {
      expect(fake.running().attach.get(id)).toEqual([pids[id]]);
    }
  });

  it("a consequence, not item 20's own claim: clicking the evicted session reattaches it", async () => {
    await drainPool();
    const ids = [1, 2, 3, 4, 5, 6, 7].map((n) => `lruC${n}`);
    await show(ids.map((id, i) => attachable(id, { repo: REPOS[i] })));

    for (const id of ids.slice(0, 6)) await attachNew(id);
    await attachNew(ids[6]); // opening the 7th evicts ids[0] (never revisited, opened first)

    await browser.waitUntil(() => (fake.running().attach.get(ids[0]) ?? []).length === 0, {
      timeout: 8000,
      timeoutMsg: `expected ${ids[0]} to have been evicted`,
    });

    const newPid = await attachNew(ids[0]);
    expect(fake.running().attach.get(ids[0])).toEqual([newPid]);
  });
});
