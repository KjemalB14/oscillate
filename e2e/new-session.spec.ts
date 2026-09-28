/**
 * PLAN-new-sessions.md, Chapter 3 slice 2, acceptance items 5-8, verbatim:
 *
 * 5. "Every group but *No folder* has a "+", and it opens a prompt box with a multi-line
 *    prompt and a mode picker offering Default, `plan`, `acceptEdits`, `auto`, `manual`
 *    and `dontAsk`, and nothing else."
 * 6. "Submit spawns exactly one `--bg`. In the group's `cwd`, argv is `--bg
 *    --permission-mode <m> <prompt>`, with no `--permission-mode` under Default. A prompt
 *    containing quotes, `$`, backticks and newlines arrives byte-exact. With an empty
 *    prompt, submit is disabled and nothing is spawned."
 * 7. "The new session opens. Within 3s of its id appearing in the list, it's the selected
 *    row, and its pane runs exactly 1 `claude attach <id>`."
 * 8. "Failures are visible and keep the prompt. A `--bg` that exits non-zero shows its
 *    stderr verbatim, with the prompt and mode still in the box. An id that isn't listed
 *    within 10s shows a message containing the id, and nothing is attached."
 *
 * Repos and ids here are unique to this spec (one app serves the whole suite).
 */
import { attachable, fake, show } from "./helpers/app.js";

const MODES: [string, string][] = [
  ["Default", ""],
  ["plan", "plan"],
  ["acceptEdits", "acceptEdits"],
  ["auto", "auto"],
  ["manual", "manual"],
  ["dontAsk", "dontAsk"],
];

const plus = (repo: string) => $(`button[aria-label="New session in ${repo}"]`);
const box = (repo: string) => $(`[role="dialog"][aria-label="New session in ${repo}"]`);
const promptArea = () => $('[role="dialog"] textarea[aria-label="Prompt"]');
const startBtn = () => $('[role="dialog"] button[type="submit"]');

async function openBox(repo: string) {
  await plus(repo).click();
  await box(repo).waitForDisplayed({ timeout: 3000 });
}

/** Sets the textarea's value the way a paste would, so newlines stay newlines. */
async function setPrompt(text: string) {
  await browser.execute((t) => {
    const ta = document.querySelector('[role="dialog"] textarea') as HTMLTextAreaElement;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(ta, t);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
}

async function pickMode(label: string) {
  await $(`//*[@role="dialog"]//label[normalize-space(.)="${label}"]`).click();
}

async function closeBox() {
  const dlg = await $('[role="dialog"]');
  if (await dlg.isExisting()) {
    const cancel = await $('//*[@role="dialog"]//button[text()="Cancel"]');
    if (await cancel.isExisting()) await cancel.click();
  }
}

/** Lists the new session so the flow completes and the box closes. */
async function finish(repo: string, oldId: string, newId: string) {
  await show([attachable(oldId, { repo }), attachable(newId, { repo })]);
  await browser.waitUntil(async () => !(await $('[role="dialog"]').isExisting()), {
    timeout: 5000,
    timeoutMsg: "the box did not close after the session was listed",
  });
}

async function bgCount() {
  return fake.bgs().length;
}

describe("a new session from the app (items 5-8)", () => {
  afterEach(async () => {
    await closeBox();
    fake.answerBg({});
  });
  after(async () => {
    await closeBox();
    fake.answerBg({});
    await show("all-states");
  });

  it('5: every group but No folder has a "+"', async () => {
    await show([
      attachable("nsa1", { repo: "nsrepoa" }),
      attachable("nsb1", { repo: "nsrepob" }),
      { ...(attachable("nsc1") as object), cwd: undefined },
    ]);
    await plus("nsrepoa").waitForExist({ timeout: 3000 });
    await plus("nsrepob").waitForExist({ timeout: 3000 });
    const groups = await $$("nav[aria-label='Sessions'] section");
    expect(groups.length).toBe(3);
    const nofolder = await $('section[aria-label="No folder"]');
    await nofolder.waitForExist({ timeout: 3000 });
    expect(await nofolder.$('button[aria-label^="New session in"]').isExisting()).toBe(false);
  });

  it("5: the box has a multi-line prompt and exactly the six modes", async () => {
    await show([attachable("nsa1", { repo: "nsrepoa" })]);
    await openBox("nsrepoa");
    const ta = await promptArea();
    expect(await ta.getTagName()).toBe("textarea");
    const labels: string[] = await browser.execute(() =>
      [...document.querySelectorAll('[role="dialog"] input[type="radio"]')].map((r) => (r.closest("label")?.textContent ?? "").trim()),
    );
    expect(labels).toEqual(MODES.map((m) => m[0]));
    expect(await $$('[role="dialog"] select').length).toBe(0);
  });

  it("6: an empty prompt disables submit and spawns nothing", async () => {
    await show([attachable("nsa1", { repo: "nsrepoa" })]);
    const before = await bgCount();
    await openBox("nsrepoa");
    expect(await startBtn().isEnabled()).toBe(false);
    await startBtn().click().catch(() => {});
    await browser.pause(1500);
    expect(await bgCount()).toBe(before);
  });

  for (const [label, flag] of MODES) {
    it(`6: mode ${label} spawns exactly one --bg in the group's cwd with the right argv`, async () => {
      const id = `nsmode${label.replace(/\W/g, "")}`;
      const repo = "nsrepom";
      fake.answerBg({ id });
      await show([attachable("nsm0", { repo })]);
      const before = await bgCount();
      await openBox(repo);
      await setPrompt(`do ${label}`);
      await pickMode(label);
      await startBtn().click();
      await browser.waitUntil(async () => (await bgCount()) > before, { timeout: 5000, timeoutMsg: "no --bg spawned" });
      await browser.pause(1000);
      const runs = fake.bgs().slice(before);
      expect(runs.length).toBe(1);
      expect(runs[0].cwd).toBe(fake.repo(repo));
      expect(runs[0].argv).toEqual(flag ? ["--bg", "--permission-mode", flag, `do ${label}`] : ["--bg", `do ${label}`]);
      await finish(repo, "nsm0", id); // list the id so the box completes and closes
    });
  }

  it("6: quotes, $, backticks and newlines arrive byte-exact", async () => {
    const repo = "nsrepox";
    const prompt = `say "hi" and 'bye' $HOME \`date\` $(id) \\n\nline two\n\n  indented\ttab ; rm -rf * | cat`;
    fake.answerBg({ id: "nsexact1" });
    await show([attachable("nsx0", { repo })]);
    const before = await bgCount();
    await openBox(repo);
    await setPrompt(prompt);
    await startBtn().click();
    await browser.waitUntil(async () => (await bgCount()) > before, { timeout: 5000 });
    await browser.pause(500);
    const runs = fake.bgs().slice(before);
    expect(runs.length).toBe(1);
    expect(runs[0].argv).toEqual(["--bg", prompt]);
    await finish(repo, "nsx0", "nsexact1");
  });

  it("7: the new session is the selected row within 3s of its id being listed, with exactly 1 attach", async () => {
    const repo = "nsrepon";
    const id = "nsnew7";
    fake.answerBg({ id });
    await show([attachable("nsn0", { repo })]);
    const before = await bgCount();
    await openBox(repo);
    await setPrompt("open me");
    await startBtn().click();
    await browser.waitUntil(async () => (await bgCount()) > before, { timeout: 5000 });
    await show([attachable("nsn0", { repo }), attachable(id, { repo })]);
    const listedAt = Date.now();
    const row = $(`//li[.//*[contains(text(),"${id}")]]`);
    await row.waitForExist({ timeout: 3000 });
    await browser.waitUntil(async () => (await row.getAttribute("aria-selected")) === "true" || (await row.getAttribute("aria-current")) === "true", {
      timeout: Math.max(100, 3000 - (Date.now() - listedAt)),
      timeoutMsg: `${id} was not the selected row within 3s of being listed`,
    });
    await browser.waitUntil(() => fake.attaches(id).length > 0, { timeout: 3000, timeoutMsg: `no attach ${id}` });
    await browser.pause(1500);
    expect(fake.attaches(id).length).toBe(1);
    expect(fake.running().attach.get(id)?.length ?? 0).toBe(1);
  });

  it("8: a --bg that exits non-zero shows its stderr verbatim, keeping prompt and mode", async () => {
    const repo = "nsrepof";
    const stderr = "boom: it broke\nsecond line <b>&amp;</b>";
    fake.answerBg({ exit: 1, stderr });
    await show([attachable("nsf0", { repo })]);
    const before = await bgCount();
    await openBox(repo);
    await setPrompt("will fail");
    await pickMode("acceptEdits");
    await startBtn().click();
    await browser.waitUntil(async () => (await bgCount()) > before, { timeout: 5000 });
    await browser.waitUntil(async () => (await $('[role="dialog"]').getText()).includes("boom: it broke"), {
      timeout: 5000,
      timeoutMsg: "stderr not shown in the box",
    });
    const text = await $('[role="dialog"]').getText();
    expect(text).toContain("second line <b>&amp;</b>");
    expect(await promptArea().getValue()).toBe("will fail");
    const checked = await $('[role="dialog"] input[type="radio"]:checked').getValue();
    expect(checked).toBe("acceptEdits");
    expect(fake.bgs().length - before).toBe(1);
  });

  it("8: an id not listed within 10s shows a message containing the id, and nothing is attached", async function () {
    this.timeout(60_000);
    const repo = "nsrepol";
    const id = "nsghost8";
    fake.answerBg({ id });
    await show([attachable("nsl0", { repo })]);
    const before = await bgCount();
    await openBox(repo);
    await setPrompt("ghost");
    await startBtn().click();
    await browser.waitUntil(async () => (await bgCount()) > before, { timeout: 5000 });
    const t0 = Date.now();
    await browser.waitUntil(async () => (await $('[role="dialog"]').getText()).includes(id), {
      timeout: 20_000,
      interval: 250,
      timeoutMsg: `no message containing ${id}`,
    });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(8000);
    expect(fake.attaches(id).length).toBe(0);
  });
});
