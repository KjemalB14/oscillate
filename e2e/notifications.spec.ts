/**
 * PLAN-notifications.md, Chapter 4 slice 1, acceptance items 1-9 (10 is by hand), quoted
 * in the names below. The oracle is the notify log (`fake.notifications()`), sliced from a
 * length recorded before each change. Fresh ids and uniquely named repos per test, so a
 * group label is the repo's name.
 */
import { attachable, appPids, dismissNotification, fake, relaunch, show, tapNotification } from "./helpers/app.js";

type Entry = Record<string, unknown>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const row = (text: string) => $(`//li[.//*[contains(text(),"${text}")]]`);
const pane = (id: string) => $(`section[aria-label="${id} terminal"]`);
const posts = (from: number, id?: string) =>
  fake.notifications().slice(from).filter((n) => n.op === "post" && (id === undefined || n.id === id));
const removes = (from: number, id: string) =>
  fake.notifications().slice(from).filter((n) => n.op === "remove" && n.id === id);
const lastBadge = (from: number) => {
  const b = fake.notifications().slice(from).filter((n) => n.op === "badge");
  return b.length ? (b.at(-1) as { count: number | null }).count : undefined;
};

const base = (id: string, repo: string, name: string): Entry => ({ ...(attachable(id, { repo, name }) as Entry) });
const working = (e: Entry): Entry => ({ ...e, status: "busy", state: "working" });
const blocked = (e: Entry, waitingFor: string): Entry => ({ ...e, status: "waiting", waitingFor, state: "blocked" });
const done = (e: Entry): Entry => {
  const { status: _s, ...rest } = e;
  return { ...rest, state: "done" };
};
const failed = (e: Entry): Entry => ({ ...done(e), state: "failed" });

/** Changes the fake's answer and returns the moment it changed. */
async function change(list: Entry[]): Promise<number> {
  const at = Date.now();
  await show(list);
  return at;
}
async function waitPosts(from: number, n: number, ms: number, id?: string) {
  await browser.waitUntil(() => posts(from, id).length >= n, { timeout: ms, interval: 50, timeoutMsg: `fewer than ${n} posts within ${ms}ms` });
}
async function selected(id: string) {
  await browser.waitUntil(
    async () => (await row(id).getAttribute("aria-selected")) === "true" || (await row(id).getAttribute("aria-current")) === "true",
    { timeout: 3000, timeoutMsg: `${id} was not the selected row` },
  );
}
async function open(id: string) {
  await row(id).waitForClickable();
  await row(id).click();
  await browser.waitUntil(() => fake.attaches(id).length === 1, { timeout: 3000, timeoutMsg: `no attach for ${id}` });
  await selected(id);
}

describe("notifications: slice 1", () => {
  afterEach(() => fake.focus("key"));
  after(async () => {
    fake.focus("key");
    await show("all-states");
  });

  it('1: "Each transition posts once" with the id, name, group label and body', async function () {
    this.timeout(60_000);
    const e = base("ntA1", "ntrepo1", "tidy the docs");
    await show([working(e)]);
    await sleep(500);
    const from = fake.notifications().length;
    const steps: [Entry, string][] = [
      [blocked(e, "approve Bash"), "approve Bash"],
      [done(e), "Done"],
      [failed(e), "Failed"],
    ];
    for (const [i, [entry, body]] of steps.entries()) {
      const t = await change([entry]);
      await waitPosts(from, i + 1, 3000, "ntA1");
      const p = posts(from, "ntA1")[i] as { at: number; id: string; title: string; subtitle: string; body: string };
      expect(p.at - t).toBeLessThan(3000);
      expect(p).toEqual(expect.objectContaining({ id: "ntA1", title: "tidy the docs", subtitle: "ntrepo1", body }));
      await sleep(1500);
      expect(posts(from, "ntA1")).toHaveLength(i + 1);
    }
  });

  it('2: "Only those three states post" (working, paused, stopped, unknown, terminal-tab)', async function () {
    this.timeout(60_000);
    const w = base("ntB1", "ntrepo2", "ntB1");
    const p = base("ntB2", "ntrepo2", "ntB2");
    const s = base("ntB3", "ntrepo2", "ntB3");
    const u = base("ntB4", "ntrepo2", "ntB4");
    const tab = (state: string, extra: Entry = {}): Entry => ({
      pid: 777001, cwd: fake.repo("ntrepo2"), kind: "interactive", startedAt: 1790000000500,
      sessionId: "22222222-2222-3333-4444-555555555555", status: "busy", ...extra,
    });
    // Everything starts in one state the log can't confuse with the target states.
    await show([{ ...p, state: "stopped" }, { ...w, state: "stopped" }, { ...s, status: "busy", state: "working" }, { ...u, state: "stopped" }, tab("x")]);
    await sleep(500);
    const from = fake.notifications().length;
    await change([
      working(w),
      p, // idle, state working = paused
      { ...s, state: "stopped" },
      { ...u, state: "mystery" },
      tab("x", { status: "waiting", waitingFor: "approve Bash", state: "blocked" }),
    ]);
    await sleep(5000);
    expect(posts(from)).toEqual([]);
    await change([working(w), p, { ...s, state: "stopped" }, { ...u, state: "mystery" }, tab("x", { state: "done" })]);
    await sleep(2500);
    await change([working(w), p, { ...s, state: "stopped" }, { ...u, state: "mystery" }, tab("x", { state: "failed" })]);
    await sleep(2500);
    expect(posts(from)).toEqual([]);
  });

  it('3: "Launch is the baseline" - launch, relaunch(), a reload post nothing; a new blocked id posts once', async function () {
    this.timeout(120_000);
    const a = blocked(base("ntC1", "ntrepo3", "ntC1"), "approve Bash");
    const b = done(base("ntC2", "ntrepo3", "ntC2"));
    const c = failed(base("ntC3", "ntrepo3", "ntC3"));
    await show([]);
    await sleep(500);
    // The old app reads the list first, so its posts land before `from`.
    await show([a, b, c]);
    await sleep(500);
    const from = fake.notifications().length;
    await relaunch();
    await row("ntC1").waitForExist({ timeout: 20_000, timeoutMsg: "the list never showed after relaunch" });
    await row("ntC3").waitForExist();
    await sleep(5000);
    expect(posts(from)).toEqual([]);

    await browser.refresh();
    await row("ntC1").waitForExist({ timeout: 20_000 });
    await sleep(5000);
    expect(posts(from)).toEqual([]);

    const d = blocked(base("ntC4", "ntrepo3", "ntC4"), "pick one");
    await change([a, b, c, d]);
    await waitPosts(from, 1, 3000);
    await sleep(2000);
    expect(posts(from).map((n) => n.id)).toEqual(["ntC4"]);
  });

  it('4: "The visible session is quiet"; another session posts once', async function () {
    this.timeout(60_000);
    const x = base("ntD1", "ntrepo4", "ntD1");
    const y = base("ntD2", "ntrepo4", "ntD2");
    await show([working(x), working(y)]);
    await open("ntD1");
    fake.focus("key");
    await sleep(500);
    const from = fake.notifications().length;
    await change([blocked(x, "approve Bash"), blocked(y, "approve Edit")]);
    await waitPosts(from, 1, 3000, "ntD2");
    await sleep(5000);
    expect(posts(from, "ntD1")).toEqual([]);
    expect(posts(from, "ntD2")).toHaveLength(1);
    expect(posts(from)).toHaveLength(1);
  });

  it('5: "One per session" - same identifier on a second post; selecting the row logs a removal', async function () {
    this.timeout(60_000);
    const e = base("ntE1", "ntrepo5", "ntE1");
    await show([working(e)]);
    await sleep(500);
    const from = fake.notifications().length;
    await change([blocked(e, "approve Bash")]);
    await waitPosts(from, 1, 3000);
    await change([done(e)]);
    await waitPosts(from, 2, 3000);
    expect(posts(from).map((n) => n.id)).toEqual(["ntE1", "ntE1"]);
    expect(removes(from, "ntE1")).toEqual([]);
    await open("ntE1");
    await browser.waitUntil(() => removes(from, "ntE1").length >= 1, { timeout: 3000, timeoutMsg: "no removal logged on selecting the row" });
  });

  it('6: "A tap opens the session" - one attach, a removal; no second attach; an unlisted id does nothing', async function () {
    this.timeout(60_000);
    const e = blocked(base("ntF1", "ntrepo6", "ntF1"), "approve Bash");
    const o = base("ntF2", "ntrepo6", "ntF2");
    await show([e, o]);
    await open("ntF2");
    const from = fake.notifications().length;
    await tapNotification("ntF1");
    await browser.waitUntil(() => fake.attaches("ntF1").length === 1, { timeout: 3000, timeoutMsg: "the tap opened nothing" });
    await selected("ntF1");
    await expect(pane("ntF1")).toBeDisplayed();
    expect(removes(from, "ntF1").length).toBeGreaterThanOrEqual(1);
    await sleep(1000);
    expect(fake.attaches("ntF1")).toHaveLength(1);

    // Already open: tap again, no second attach.
    await row("ntF2").click();
    await selected("ntF2");
    await tapNotification("ntF1");
    await selected("ntF1");
    await sleep(1500);
    expect(fake.attaches("ntF1")).toHaveLength(1);

    // An id that isn't listed.
    const attachesBefore = fake.argvs().filter((a) => a[0] === "attach").length;
    await tapNotification("ntNOPE");
    await sleep(2000);
    await selected("ntF1");
    expect(fake.attaches("ntNOPE")).toEqual([]);
    expect(fake.argvs().filter((a) => a[0] === "attach").length).toBe(attachesBefore);
  });

  it('7: "A dismissal does nothing"', async function () {
    this.timeout(60_000);
    const a = blocked(base("ntG1", "ntrepo7", "ntG1"), "approve Bash");
    const b = base("ntG2", "ntrepo7", "ntG2");
    await show([a, b]);
    await open("ntG2");
    const attachesBefore = fake.argvs().filter((x) => x[0] === "attach").length;
    await dismissNotification("ntG1");
    await sleep(3000);
    await selected("ntG2");
    expect(fake.attaches("ntG1")).toEqual([]);
    expect(fake.argvs().filter((x) => x[0] === "attach").length).toBe(attachesBefore);
  });

  it('8: "The Dock badge counts needs you" - none, "1", "3", none again, selected or not', async function () {
    this.timeout(60_000);
    const ids = ["ntH1", "ntH2", "ntH3"];
    const es = ids.map((id) => base(id, "ntrepo8", id));
    await show(es.map(working));
    await open("ntH1");
    const expectBadge = async (list: Entry[], want: number | null) => {
      const from = fake.notifications().length;
      await change(list);
      await browser.waitUntil(() => lastBadge(from) === want || (want === null && lastBadge(from) === undefined && fake.notifications().slice(0, from).filter((n) => n.op === "badge").at(-1)?.count === null), {
        timeout: 3000, interval: 50, timeoutMsg: `the badge did not become ${want} within 3s (last: ${lastBadge(from)})`,
      });
    };
    await expectBadge(es.map(working), null);
    // The first one, which is selected, is among the blocked.
    await expectBadge([blocked(es[0], "q"), working(es[1]), working(es[2])], 1);
    await expectBadge(es.map((e) => blocked(e, "q")), 3);
    await expectBadge(es.map(working), null);
  });

  it('9: "Nothing under the watched Claude dir is written"', () => {
    expect(appPids().length).toBeGreaterThan(0);
    expect(fake.claudeDirTree()).toEqual(fake.claudeDirBaseline());
  });
});
