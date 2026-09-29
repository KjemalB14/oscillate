/**
 * PLAN-new-sessions.md, Chapter 3 slice 3, acceptance items 13-16, verbatim:
 *
 * 13. "Untrusted opens the trust pane. When `--bg` fails with `Workspace not trusted`, a
 *     pane labelled "Accept trust, then /exit" runs exactly one interactive `claude` (no
 *     `--bg`, no prompt) in that `cwd`."
 * 14. "Its exit retries once. When the trust pane's process exits, exactly 1 more `--bg` is
 *     spawned, with the kept prompt and mode. When it succeeds, item 7 holds."
 * 15. "Still untrusted stops there. When the retry fails with `Workspace not trusted`, the
 *     box shows "Not trusted, nothing started" with the prompt kept, and no further `--bg`
 *     or trust `claude` is spawned within 10s."
 * 16. "The app never kills the trust pane. While it's open, 7 other sessions are opened
 *     (past the LRU cap), <- and Ctrl+Z are sent to other panes, and Cmd+Q is pressed. The
 *     trust `claude`'s pid is alive throughout, it receives no signal from the app, and
 *     Cmd+Q shows "Answer the trust prompt first". A second "+" on an untrusted repo
 *     focuses the existing pane and spawns nothing."
 *
 * Item 17 is by hand. Repos and ids are unique to this spec.
 */
import { attachable, fake, press, show } from "./helpers/app.js";

const plus = (repo: string) => $(`button[aria-label="New session in ${repo}"]`);
const box = (repo: string) => $(`[role="dialog"][aria-label="New session in ${repo}"]`);
const startBtn = () => $('[role="dialog"] button[type="submit"]');
const label = () => $('//*[contains(text(),"Accept trust, then /exit")]');
const row = (id: string) => $(`//li[.//*[contains(text(),"${id}")]]`);

async function setPrompt(text: string) {
  await browser.execute((t) => {
    const ta = document.querySelector('[role="dialog"] textarea') as HTMLTextAreaElement;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(ta, t);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
}

/** Untrusts `repo`, submits a prompt from its "+", and waits for the trust pane. */
async function startUntrusted(repo: string, prompt: string, mode = "acceptEdits", others: object[] = []) {
  fake.untrust(fake.repo(repo));
  await show([attachable(`${repo}0`, { repo }), ...others]);
  await plus(repo).click();
  await box(repo).waitForDisplayed({ timeout: 3000 });
  await setPrompt(prompt);
  await $(`//*[@role="dialog"]//label[normalize-space(.)="${mode}"]`).click();
  await startBtn().click();
  await label().waitForDisplayed({ timeout: 5000 });
  await browser.waitUntil(() => fake.trusts().some((t) => t.cwd === fake.repo(repo)), {
    timeout: 5000,
    timeoutMsg: "no trust claude spawned",
  });
}

/** Focuses the terminal in the trust pane's container (the nearest ancestor of its label holding one). */
async function focusTrustPane() {
  const el = await label();
  await browser.execute((lab: HTMLElement) => {
    for (let n: HTMLElement | null = lab; n; n = n.parentElement) {
      const ta = n.querySelector("textarea");
      if (ta) return ta.focus();
    }
  }, el as unknown as HTMLElement);
}

/** Types into the trust pane, focusing it first if need be. */
async function typeInTrustPane(...keys: string[]) {
  try {
    await press(...keys);
  } catch {
    await focusTrustPane();
    await press(...keys);
  }
}

const trustsIn = (repo: string) => fake.trusts().filter((t) => t.cwd === fake.repo(repo));
const bgsIn = (repo: string) => fake.bgs().filter((b) => b.cwd === fake.repo(repo));

/** Accepts trust and exits the trust claude. */
async function acceptAndExit(repo: string) {
  await typeInTrustPane("1");
  await browser.waitUntil(() => !fake.untrusted().includes(fake.repo(repo)), { timeout: 5000 });
  // press() gives "/" keyCode 47, which xterm.js ignores; a real "/" is keyCode 191.
  await browser.execute(() => {
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "/", code: "Slash", keyCode: 191, bubbles: true, cancelable: true }));
  });
  await press("exit", "Enter");
}

/** Answers any trust pane still open, so nothing outlives the spec. */
async function drain() {
  for (let i = 0; i < 5 && fake.running().trust.length > 0; i++) {
    try {
      await typeInTrustPane("2");
    } catch {
      /* try again */
    }
    await browser.pause(500);
  }
  await browser.waitUntil(() => fake.running().trust.length === 0, { timeout: 5000, timeoutMsg: "a trust pane is still open" });
}

describe("the trust pane (items 13-16)", () => {
  const repos = ["tprepo13", "tprepo14", "tprepo15", "tprepo16"];
  afterEach(async () => {
    await drain();
    const dlg = await $('[role="dialog"]');
    if (await dlg.isExisting()) {
      const cancel = await $('//*[@role="dialog"]//button[text()="Cancel"]');
      if (await cancel.isExisting()) await cancel.click().catch(() => {});
    }
    fake.answerBg({});
  });
  after(async () => {
    for (const r of repos) fake.trust(fake.repo(r));
    await show("all-states");
  });

  it('13: an untrusted --bg opens a pane labelled "Accept trust, then /exit" running exactly one bare claude in that cwd', async () => {
    const repo = "tprepo13";
    await startUntrusted(repo, "prompt thirteen");
    expect(await label().isDisplayed()).toBe(true);
    await browser.pause(2000);
    const trusts = trustsIn(repo);
    expect(trusts.length).toBe(1);
    expect(trusts[0].argv).toEqual([]);
    expect(trusts[0].cwd).toBe(fake.repo(repo));
    expect(fake.running().trust).toContain(trusts[0].pid);
    // the one --bg was the failed attempt; the trust claude took no prompt.
    expect(bgsIn(repo).length).toBe(1);
    expect(bgsIn(repo)[0].argv).toEqual(["--bg", "--permission-mode", "acceptEdits", "prompt thirteen"]);
  });

  it("14: the trust pane's exit retries --bg exactly once, with the kept prompt and mode, and item 7 holds", async () => {
    const repo = "tprepo14";
    const id = "tpnew14";
    const prompt = 'keep "this" $HOME\nsecond line';
    await startUntrusted(repo, prompt);
    expect(bgsIn(repo).length).toBe(1);
    fake.answerBg({ id });
    await acceptAndExit(repo);
    await browser.waitUntil(() => bgsIn(repo).length >= 2, { timeout: 5000, timeoutMsg: "no retry --bg after the trust pane exited" });
    await browser.pause(4000);
    const runs = bgsIn(repo);
    expect(runs.length).toBe(2);
    expect(runs[1].cwd).toBe(fake.repo(repo));
    expect(runs[1].argv).toEqual(["--bg", "--permission-mode", "acceptEdits", prompt]);
    expect(trustsIn(repo).length).toBe(1);
    // item 7: listed id is selected within 3s, one attach.
    await show([attachable(`${repo}0`, { repo }), attachable(id, { repo })]);
    const listedAt = Date.now();
    await row(id).waitForExist({ timeout: 3000 });
    await browser.waitUntil(
      async () => (await row(id).getAttribute("aria-selected")) === "true" || (await row(id).getAttribute("aria-current")) === "true",
      { timeout: Math.max(100, 3000 - (Date.now() - listedAt)), timeoutMsg: `${id} was not selected within 3s of being listed` },
    );
    await browser.waitUntil(() => fake.attaches(id).length > 0, { timeout: 3000 });
    await browser.pause(1500);
    expect(fake.attaches(id).length).toBe(1);
    expect(fake.running().attach.get(id)?.length ?? 0).toBe(1);
  });

  it('15: still untrusted shows "Not trusted, nothing started", keeps the prompt, and spawns nothing more within 10s', async function () {
    this.timeout(60_000);
    const repo = "tprepo15";
    await startUntrusted(repo, "prompt fifteen", "plan");
    await typeInTrustPane("2"); // "No, exit"
    await browser.waitUntil(() => fake.trustExits().some((e) => e.how === "declined"), { timeout: 5000 });
    await browser.waitUntil(async () => (await $('[role="dialog"]').getText()).includes("Not trusted, nothing started"), {
      timeout: 5000,
      timeoutMsg: "no 'Not trusted, nothing started'",
    });
    expect(await $('[role="dialog"] textarea').getValue()).toBe("prompt fifteen");
    const t0 = Date.now();
    await browser.waitUntil(() => bgsIn(repo).length >= 2, { timeout: 5000, timeoutMsg: "no retry" });
    const bgsAtStop = bgsIn(repo).length;
    expect(bgsAtStop).toBe(2);
    const until = t0 + 10_000;
    while (Date.now() < until) {
      expect(bgsIn(repo).length).toBe(bgsAtStop);
      expect(trustsIn(repo).length).toBe(1);
      await browser.pause(100);
    }
    await browser.pause(500);
    expect(bgsIn(repo).length).toBe(2);
    expect(trustsIn(repo).length).toBe(1);
    expect(await $('[role="dialog"]').getText()).toContain("Not trusted, nothing started");
  });

  it("16: the trust claude is never killed or signalled while 7 sessions open, <- and Ctrl+Z go to other panes, and Cmd+Q is refused; a second + focuses it and spawns nothing", async function () {
    this.timeout(120_000);
    const repo = "tprepo16";
    const others = Array.from({ length: 8 }, (_, i) => attachable(`tpo16x${i}`, { repo: "tprepo16other" }));
    await startUntrusted(repo, "prompt sixteen", "acceptEdits", others);
    const pid = trustsIn(repo)[0].pid;
    const bgsBefore = fake.bgs().length;
    const trustsBefore = fake.trusts().length;
    const alive = () => fake.running().trust.includes(pid);
    const check = () => {
      expect(alive()).toBe(true);
      expect(fake.trustSignals(pid)).toEqual([]);
      expect(fake.trustExits().filter((e) => e.pid === pid)).toEqual([]);
    };
    check();

    // 7 other sessions, past the LRU cap of 6.
    for (let i = 0; i < 7; i++) {
      const id = `tpo16x${i}`;
      await row(id).click();
      await browser.waitUntil(() => fake.attaches(id).length > 0, { timeout: 5000, timeoutMsg: `no attach ${id}` });
      check();
    }
    // <- and Ctrl+Z go to other panes.
    await press("ArrowLeft");
    await browser.pause(1500);
    check();
    await row("tpo16x6").click();
    await browser.pause(500);
    await row("tpo16x5").click();
    await browser.waitUntil(() => fake.attaches("tpo16x5").length > 0, { timeout: 5000 });
    await browser.pause(500);
    await press("Ctrl+Z");
    await browser.pause(1500);
    check();

    // Cmd+Q is refused.
    await press("Cmd+Q");
    const refusal = $('//*[contains(text(),"Answer the trust prompt first")]');
    await refusal.waitForDisplayed({ timeout: 3000 });
    // A second "+" on the untrusted repo focuses the existing pane and spawns nothing.
    await plus(repo).click();
    await label().waitForDisplayed({ timeout: 3000 });
    let focusInTerminal = false;
    await browser
      .waitUntil(async () => (focusInTerminal = await browser.execute(() => !!document.activeElement?.closest(".xterm"))), { timeout: 2000 })
      .catch(() => {});
    if (!focusInTerminal) throw new Error("second + left focus outside a terminal: " + (await browser.execute(() => { const a = document.activeElement as HTMLElement; return a.tagName + " " + (a.getAttribute("aria-label") ?? "") + " " + (a.textContent ?? "").slice(0, 40); })));
    const until = Date.now() + 4000;
    while (Date.now() < until) {
      check();
      expect(fake.bgs().length).toBe(bgsBefore);
      expect(fake.trusts().length).toBe(trustsBefore);
      expect(fake.running().trust.length).toBe(1);
      await browser.pause(100);
    }
    check();
    // Answer it, so nothing outlives the spec.
    await typeInTrustPane("2");
    await browser.waitUntil(() => !alive(), { timeout: 5000 });
  });
});
