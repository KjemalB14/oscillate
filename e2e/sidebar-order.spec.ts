/**
 * PLAN-new-sessions.md, Chapter 3 slice 1 "rows stay still", acceptance items 1-4, verbatim:
 *
 * 1. "A respawn doesn't move a row. When the fake gives an existing row a newer `startedAt`
 *    than every other row, the row's position in its group is unchanged 2.5s later, and
 *    still unchanged after 10 more polls."
 * 2. "A renamed row doesn't move. When the fake changes a row's `name`, its position is
 *    unchanged 2.5s later."
 * 3. "A new session goes on top. A new key with the newest `startedAt` shows first in its
 *    group within 2.5s, and the other rows keep their relative order."
 * 4. "Order is frozen for the app process, not the page. After a webview reload, rows keep
 *    the order from items 1-3."
 *
 * One app runs for the whole suite, and the order it remembers for a key outlives a spec,
 * so this file owns the ids `ordaaa`.. and the repo "ordrepo". The items build on each
 * other in file order, as 4 says. Fixture: A, B, C start at 100, 200, 300 past a base, so
 * newest-first is C, B, A.
 */
import { attachable, fake, nextPoll, show } from "./helpers/app.js";

const BASE = 1790000000000;
const REPO = "ordrepo";

type Entry = { id: string; name: string; startedAt: number };

function entry(id: string, name: string, startedAt: number): object {
  return { ...(attachable(id, { repo: REPO, name }) as object), startedAt: BASE + startedAt };
}

/** Names of the group's rows, top to bottom, as displayed. */
async function rowNames(): Promise<string[]> {
  const rows = await $$(`section[aria-label="${REPO}"] li`);
  const out: string[] = [];
  for (const r of rows) out.push(await r.getText());
  return out;
}

/** Waits until the rows read, in order, containing the given names. */
async function expectOrder(names: string[], timeout = 2500) {
  let last: string[] = [];
  await browser.waitUntil(
    async () => {
      last = await rowNames();
      return last.length === names.length && names.every((n, i) => last[i].includes(n));
    },
    { timeout, interval: 100, timeoutMsg: `expected order ${names.join(", ")}, got ${JSON.stringify(last)}` },
  );
}

async function assertOrderNow(names: string[]) {
  const got = await rowNames();
  expect(got.length).toBe(names.length);
  names.forEach((n, i) => expect(got[i]).toContain(n));
}

describe("sidebar rows stay still (chapter 3, slice 1, items 1-4)", () => {
  it("a respawn doesn't move a row", async function () {
    this.timeout(90_000);
    await show([entry("ordaaa", "ordnamea", 100), entry("ordbbb", "ordnameb", 200), entry("ordccc", "ordnamec", 300)]);
    await expectOrder(["ordnamec", "ordnameb", "ordnamea"], 5000);

    // Respawn the oldest row (A): a startedAt newer than every other row.
    const before = Date.now();
    fake.setOut([entry("ordaaa", "ordnamea", 9000), entry("ordbbb", "ordnameb", 200), entry("ordccc", "ordnamec", 300)]);
    fake.touch();
    await nextPoll();
    await new Promise((r) => setTimeout(r, Math.max(0, 2500 - (Date.now() - before))));
    await assertOrderNow(["ordnamec", "ordnameb", "ordnamea"]);

    const polls = fake.polls();
    await browser.waitUntil(() => fake.polls() >= polls + 10, { timeout: 40_000, interval: 250 });
    await assertOrderNow(["ordnamec", "ordnameb", "ordnamea"]);
  });

  it("a renamed row doesn't move", async function () {
    this.timeout(30_000);
    const before = Date.now();
    fake.setOut([entry("ordaaa", "ordnamea", 9000), entry("ordbbb", "ordrenamed", 200), entry("ordccc", "ordnamec", 300)]);
    fake.touch();
    await nextPoll();
    await new Promise((r) => setTimeout(r, Math.max(0, 2500 - (Date.now() - before))));
    // B was in the middle, and still is, under its new name.
    await assertOrderNow(["ordnamec", "ordrenamed", "ordnamea"]);
  });

  it("a new session goes on top, and the others keep their order", async function () {
    this.timeout(30_000);
    fake.setOut([
      entry("ordaaa", "ordnamea", 9000),
      entry("ordbbb", "ordrenamed", 200),
      entry("ordccc", "ordnamec", 300),
      entry("ordddd", "ordnamed", 5000),
    ]);
    fake.touch();
    await expectOrder(["ordnamed", "ordnamec", "ordrenamed", "ordnamea"], 2500);
  });

  it("order is frozen for the app process, not the page: a webview reload keeps it", async function () {
    this.timeout(30_000);
    await browser.execute(() => {
      (window as unknown as { __wasReloaded?: boolean }).__wasReloaded = true;
      setTimeout(() => location.reload(), 0);
    });
    await browser.waitUntil(
      async () => !(await browser.execute(() => (window as unknown as { __wasReloaded?: boolean }).__wasReloaded)),
      { timeout: 10_000, timeoutMsg: "the page did not reload" },
    );
    await expectOrder(["ordnamed", "ordnamec", "ordrenamed", "ordnamea"], 5000);
    await assertOrderNow(["ordnamed", "ordnamec", "ordrenamed", "ordnamea"]);
  });
});
