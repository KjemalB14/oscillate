/**
 * PLAN-notifications.md, Chapter 4 slice 2 "The PR link", acceptance items 11-15 (16 is
 * cargo test, 17 by hand). The oracle is what each fake job's state.json names (the
 * fixture) and the fake's opener log (`fake.opened()`). Every job is removed at the end.
 */
import { attachable, fake, show } from "./helpers/app.js";

type Entry = Record<string, unknown>;
const href = (n: number) => `https://github.com/example/repo/pull/${n}`;
const row = (name: string) => $(`//li[.//*[text()="${name}"]]`);
const chip = (n: number) => $(`button[aria-label="PR #${n}"]`);
const more = (name: string) => $(`button[aria-label*="more PRs from ${name}"]`);
const menu = (name: string) => $(`[role="menu"][aria-label="More PRs from ${name}"]`);
const blocked = (id: string, repo: string, name: string): Entry => ({
  ...(attachable(id, { repo, name }) as Entry),
  status: "waiting",
  waitingFor: "approve the plan",
  state: "blocked",
});
const withJobs = async (ids: string[], body: () => Promise<void>) => {
  try {
    await body();
  } finally {
    for (const id of ids) fake.job(id, null);
    await show("empty");
  }
};
async function opened(action: () => Promise<void>): Promise<string[]> {
  const before = fake.opened().length;
  await action();
  await browser.waitUntil(() => fake.opened().length > before, { timeout: 3000, timeoutMsg: "nothing reached the opener" });
  return fake.opened().slice(before);
}

describe("Slice 2: the PR link", () => {
  it("11. Newest, plus a count: #46 and +4 within 3s", async () => {
    await withJobs(["prlk11"], async () => {
      await show([attachable("prlk11", { repo: "prlk-eleven", name: "eleven" })]);
      fake.job("prlk11", fake.prState([42, 43, 44, 45, 46]));
      await chip(46).waitForExist({ timeout: 3000, timeoutMsg: "no #46 within 3s" });
      await expect(chip(46)).toHaveText("#46");
      await expect(more("eleven")).toHaveText("+4");
      expect(await row("eleven").$("button*=#46").isExisting()).toBe(true);
    });
  });

  it("11. Clicking #46 sends exactly that href to the opener", async () => {
    await withJobs(["prlk11"], async () => {
      fake.job("prlk11", fake.prState([42, 43, 44, 45, 46]));
      await show([attachable("prlk11", { repo: "prlk-eleven", name: "eleven" })]);
      await chip(46).waitForExist({ timeout: 3000 });
      expect(await opened(() => chip(46).click())).toEqual([href(46)]);
    });
  });

  it("11. +4 opens a menu of #45, #44, #43 and #42 in that order, and each item sends its own href", async () => {
    await withJobs(["prlk11"], async () => {
      fake.job("prlk11", fake.prState([42, 43, 44, 45, 46]));
      await show([attachable("prlk11", { repo: "prlk-eleven", name: "eleven" })]);
      await more("eleven").waitForExist({ timeout: 3000 });
      const expected = [45, 44, 43, 42];
      for (const n of expected) {
        await more("eleven").click();
        await menu("eleven").waitForExist({ timeoutMsg: "no menu" });
        const texts: string[] = [];
        for (const el of await $$('[role="menu"] [role="menuitem"]')) texts.push(await el.getText());
        expect(texts).toEqual(expected.map((m) => `#${m}`));
        const item = await menu("eleven").$(`[role="menuitem"]=#${n}`);
        expect(await opened(() => item.click())).toEqual([href(n)]);
      }
    });
  });

  it("12. One PR, no count: the row shows #N and no +", async () => {
    await withJobs(["prlk12"], async () => {
      fake.job("prlk12", fake.prState([7]));
      await show([attachable("prlk12", { repo: "prlk-twelve", name: "twelve" })]);
      await chip(7).waitForExist({ timeout: 3000, timeoutMsg: "no #7" });
      await expect(chip(7)).toHaveText("#7");
      expect(await more("twelve").isExisting()).toBe(false);
      expect(await row("twelve").getText()).not.toContain("+");
    });
  });

  describe("13. Every miss is no chip", () => {
    const misses: [string, (id: string) => void][] = [
      ["a missing state.json", () => {}],
      ["an empty file", (id) => fake.job(id, "")],
      ["invalid JSON", (id) => fake.job(id, "{ not json")],
      ["no children", (id) => fake.job(id, { title: "x" })],
      ["only non-pr children", (id) => fake.job(id, { children: [{ id: "9", href: href(9), kind: "issue" }] })],
      ["a PR child whose href isn't https://", (id) => fake.job(id, { children: [{ id: "9", href: "http://github.com/example/repo/pull/9", kind: "pr" }] })],
    ];
    misses.forEach(([label, write], i) => {
      it(`${label} shows no chip; name, state dot and waitingFor match the same session with no state.json; other rows' chips are unaffected`, async () => {
        const id = `prmiss${i}`, good = `prgood${i}`;
        const name = `missrow${i}`, goodName = `goodrow${i}`;
        await withJobs([id, good], async () => {
          const list = [blocked(id, `prlk-miss${i}`, name), blocked(good, `prlk-good${i}`, goodName)];
          // Control: the same session with no state.json.
          fake.job(good, fake.prState([20 + i]));
          await show(list);
          await chip(20 + i).waitForExist({ timeout: 3000 });
          const controlHtml = await row(name).getHTML();
          const controlText = await row(name).getText();
          expect(controlText).toContain(name);
          expect(controlText).toContain("approve the plan");
          // Now the miss.
          write(id);
          fake.touch();
          await show(list);
          await browser.pause(1500);
          expect(await chip(20 + i).isExisting()).toBe(true); // other rows unaffected
          expect(await row(name).$("button*=#").isExisting()).toBe(false);
          expect(await row(name).$('[aria-haspopup="menu"]').isExisting()).toBe(false);
          expect(await row(name).getHTML()).toEqual(controlHtml);
        });
      });
    });
  });

  it("14. It follows the file: gains a PR child, the chip appears within 3s; deleted, the chip goes within 3s", async () => {
    await withJobs(["prlk14"], async () => {
      fake.job("prlk14", fake.prState([]));
      await show([attachable("prlk14", { repo: "prlk-fourteen", name: "fourteen" })]);
      await row("fourteen").waitForExist();
      await browser.pause(500);
      expect(await row("fourteen").$("button*=#").isExisting()).toBe(false);

      fake.job("prlk14", fake.prState([31]));
      await chip(31).waitForExist({ timeout: 3000, timeoutMsg: "chip did not appear within 3s of the PR child" });

      fake.job("prlk14", null);
      await browser.waitUntil(async () => !(await chip(31).isExisting()), { timeout: 3000, interval: 100, timeoutMsg: "chip stayed after the file was deleted" });
      expect(await row("fourteen").isExisting()).toBe(true);
    });
  });

  it("15. Read only: the OSCILLATE_CLAUDE_DIR tree is unchanged by the app", async () => {
    await withJobs(["prlk15"], async () => {
      fake.job("prlk15", fake.prState([1, 2, 3]));
      await show([attachable("prlk15", { repo: "prlk-fifteen", name: "fifteen" })]);
      await chip(3).waitForExist({ timeout: 3000 });
      await opened(() => chip(3).click());
      await browser.pause(2500); // a poll or two
      expect(fake.claudeDirTree()).toEqual(fake.claudeDirExpected());
      fake.job("prlk15", "garbage");
      await show([attachable("prlk15", { repo: "prlk-fifteen", name: "fifteen" })]);
      await browser.pause(500);
      expect(fake.claudeDirTree()).toEqual(fake.claudeDirExpected());
    });
    expect(fake.claudeDirTree()).toEqual(fake.claudeDirBaseline());
  });
});
