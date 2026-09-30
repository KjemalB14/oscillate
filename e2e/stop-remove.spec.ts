/**
 * PLAN-new-sessions.md, Slice 4: Stop and Remove, items 18-21, quoted in the names below.
 *
 * Locators come from a probe of the open menu: `[role="menu"]` holding `[role="menuitem"]`s
 * named Stop and Remove, and a `[role="group"]` named "Remove <id>?" holding Remove and
 * Cancel buttons. Fresh ids and repos per test; the app is shared by the whole suite.
 *
 * Item 21's whole-run argv claim: `fake.argvs()` at the end of this spec covers every spec
 * that ran before it in this run plus this one, and no more.
 */
import { attachable, fake, rightClick, show } from "./helpers/app.js";

const row = (text: string) => $(`//li[.//*[contains(text(),"${text}")]]`);
const menu = () => $('[role="menu"]');
const items = async () => (await $$('[role="menu"] [role="menuitem"]').map((e) => e.getText())) as string[];
const pane = (id: string) => $(`section[aria-label="${id} terminal"]`);
const confirm = (id: string) => $(`[role="group"][aria-label="Remove ${id}?"]`);
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function openMenu(text: string) {
  await row(text).waitForExist({ timeoutMsg: `row ${text} never appeared` });
  await rightClick(row(text));
}
async function closeMenu() {
  await browser.keys(["Escape"]);
  if (await menu().isExisting()) await $("main").click();
  await browser.waitUntil(async () => !(await menu().isExisting()), { timeoutMsg: "menu did not close" });
}
async function attachRow(id: string) {
  await row(id).waitForClickable();
  await row(id).click();
  await browser.waitUntil(() => fake.attaches(id).length > 0, { timeout: 3000, timeoutMsg: `no attach for ${id}` });
  await expect(pane(id)).toBeDisplayed();
}
const item = (name: string) => $('[role="menu"]').$(`button=${name}`);
const stateOf = (text: string) => row(text).$('[role="img"]');

describe("item 18: The menu matches the row", () => {
  it("a right-click on a live background row offers Stop and Remove", async () => {
    await show([
      { ...(attachable("mnWork", { repo: "mnrepo1" }) as object), status: "busy", state: "working" },
      { ...(attachable("mnBlock", { repo: "mnrepo1" }) as object), status: "waiting", waitingFor: "approve Bash", state: "blocked" },
      attachable("mnPause", { repo: "mnrepo1" }),
    ]);
    for (const [id, label] of [["mnWork", "working"], ["mnBlock", "needs you"], ["mnPause", "paused"]]) {
      await expect(stateOf(id)).toHaveAttribute("aria-label", label);
      await openMenu(id);
      await menu().waitForExist();
      expect(await items()).toEqual(["Stop", "Remove"]);
      await closeMenu();
    }
  });

  it("a done, failed or stopped row offers only Remove", async () => {
    const base = (id: string, state: string) => {
      const { status, ...rest } = attachable(id, { repo: "mnrepo2" }) as any;
      return { ...rest, state };
    };
    await show([base("mnDone", "done"), base("mnFail", "failed"), base("mnStop", "stopped")]);
    for (const [id, label] of [["mnDone", "done"], ["mnFail", "failed"], ["mnStop", "stopped"]]) {
      await expect(stateOf(id)).toHaveAttribute("aria-label", label);
      await openMenu(id);
      await menu().waitForExist();
      expect(await items()).toEqual(["Remove"]);
      await closeMenu();
    }
  });

  it("a terminal-tab row has no menu", async () => {
    const repo = fake.repo("mnrepo3");
    await show([
      attachable("mnAnchor", { repo: "mnrepo3" }),
      { pid: 4999, cwd: repo, kind: "interactive", startedAt: 1790000000500, sessionId: "11111111-2222-3333-4444-666666666666", status: "busy" },
    ]);
    const tab = $('//li[.//*[@aria-label="terminal tab"]]');
    await tab.waitForExist();
    await rightClick(tab);
    await sleep(700);
    expect(await menu().isExisting()).toBe(false);
    // The harness does open a menu on a background row in the same group.
    await openMenu("mnAnchor");
    await menu().waitForExist();
    await closeMenu();
  });
});

describe("item 19: Stop closes the pane first", () => {
  before(() => fake.lingerOnHangup(600));
  after(() => fake.lingerOnHangup(0));

  it("records stop <id> after the last attach <id> exited, exactly 1 stop, row Stopped within 2.5s, then a click starts exactly 1 attach", async () => {
    const id = "stpA1";
    await show([{ ...(attachable(id, { repo: "stprepo" }) as object), status: "busy" }]);
    await attachRow(id);
    expect(fake.attaches(id).length).toBe(1);

    await openMenu(id);
    await item("Stop").waitForClickable();
    const t0 = Date.now();
    await item("Stop").click();

    await browser.waitUntil(async () => (await stateOf(id).getAttribute("aria-label")) === "stopped", {
      timeout: 2500,
      timeoutMsg: "row did not show Stopped within 2.5s",
    });
    expect(Date.now() - t0).toBeLessThan(2600);
    await sleep(3000);
    const stops = fake.stops().filter((s) => s.argv.includes(id));
    expect(stops.length).toBe(1);
    expect(stops[0].argv).toEqual(["stop", id]);
    const attaches = fake.attaches(id);
    const exits = fake.attachExits(id);
    expect(exits.length).toBe(attaches.length);
    expect(stops[0].attached).toEqual([]);
    expect(stops[0].at).toBeGreaterThanOrEqual(Math.max(...exits.map((e) => e.at)));
    expect(fake.running().attach.get(id) ?? []).toEqual([]);

    await row(id).click();
    await browser.waitUntil(() => fake.attaches(id).length === attaches.length + 1, { timeout: 3000, timeoutMsg: "click after Stop started no attach" });
    await sleep(3000);
    expect(fake.attaches(id).length).toBe(attaches.length + 1);
  });
});

describe("item 20: Remove confirms", () => {
  before(() => fake.lingerOnHangup(600));
  after(() => fake.lingerOnHangup(0));

  it("cancelling spawns nothing and leaves the pane attached", async () => {
    const id = "rmCan1";
    await show([{ ...(attachable(id, { repo: "rmrepo1" }) as object), status: "busy" }]);
    await attachRow(id);
    const pid = fake.attaches(id)[0].pid;
    const before = fake.rms().length;
    const stopsBefore = fake.stops().length;

    await openMenu(id);
    await item("Remove").click();
    await confirm(id).waitForExist();
    await confirm(id).$("button=Cancel").click();
    await browser.waitUntil(async () => !(await confirm(id).isExisting()), { timeoutMsg: "confirm stayed after Cancel" });
    await sleep(3000);
    expect(fake.rms().length).toBe(before);
    expect(fake.stops().length).toBe(stopsBefore);
    await expect(row(id)).toBeExisting();
    expect(fake.attachExits(id).length).toBe(0);
    expect(fake.running().attach.get(id)).toEqual([pid]);
    expect(fake.attaches(id).length).toBe(1);
    await expect(pane(id)).toBeDisplayed();
  });

  it("confirming closes the pane first, spawns exactly 1 `rm <id>` with no other arguments, and the row is gone within 2.5s", async () => {
    const id = "rmOk1";
    await show([{ ...(attachable(id, { repo: "rmrepo2" }) as object), status: "busy" }]);
    await attachRow(id);
    await openMenu(id);
    await item("Remove").click();
    await confirm(id).waitForExist();
    const t0 = Date.now();
    await confirm(id).$("button=Remove").click();
    await browser.waitUntil(async () => !(await row(id).isExisting()), { timeout: 2500, timeoutMsg: "row still there 2.5s after confirming" });
    expect(Date.now() - t0).toBeLessThan(2600);
    await sleep(3000);
    const rms = fake.rms().filter((r) => r.argv.includes(id));
    expect(rms.length).toBe(1);
    expect(rms[0].argv).toEqual(["rm", id]);
    expect(rms[0].attached).toEqual([]);
    const exits = fake.attachExits(id);
    expect(exits.length).toBe(fake.attaches(id).length);
    expect(rms[0].at).toBeGreaterThanOrEqual(Math.max(...exits.map((e) => e.at)));
    expect(fake.running().attach.get(id) ?? []).toEqual([]);
  });
});

describe("item 21: A refusal is shown verbatim", () => {
  after(() => fake.answerRm());

  it("shows rm's output verbatim and selectable, keeps the row, spawns no second rm; no argv anywhere has --discard-unpushed or --force-remove-worktree", async () => {
    const id = "rmNo1";
    fake.answerRm({ exit: 1 });
    await show([{ ...(attachable(id, { repo: "rmrepo3" }) as object), status: "busy" }]);
    await openMenu(id);
    await item("Remove").click();
    await confirm(id).waitForExist();
    await confirm(id).$("button=Remove").click();

    const want = norm(fake.rmRefusal(id));
    await browser.waitUntil(async () => norm(await browser.execute(() => document.body.innerText)).includes(want), {
      timeout: 5000,
      timeoutMsg: "the refusal text never appeared verbatim on screen",
    });
    // Selectable: select the text node's element and read the selection back.
    const sel = await browser.execute((first: string) => {
      const all = [...document.querySelectorAll<HTMLElement>("body *")].filter((e) => (e.textContent ?? "").includes(first));
      const el = all[all.length - 1];
      if (!el) return { ok: false, why: "no element" };
      if (getComputedStyle(el).userSelect === "none") return { ok: false, why: "user-select: none" };
      const range = document.createRange();
      range.selectNodeContents(el);
      const s = getSelection()!;
      s.removeAllRanges();
      s.addRange(range);
      return { ok: s.toString().includes(first), why: s.toString() };
    }, fake.rmRefusal(id).split("\n")[0].slice(0, 20));
    expect(sel).toEqual(expect.objectContaining({ ok: true }));

    await sleep(3500);
    await expect(row(id)).toBeDisplayed();
    expect(fake.rms().filter((r) => r.argv.includes(id)).length).toBe(1);
    await expect(row(id)).toBeDisplayed();

    const bad = fake.argvs().filter((a: unknown) => /--discard-unpushed|--force-remove-worktree/.test(JSON.stringify(a)));
    expect(bad).toEqual([]);
  });
});
