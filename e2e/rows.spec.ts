/**
 * PLAN-ui-pass.md, Chapter 5 slice 3 "Rows", acceptance items 11-13, verbatim:
 *
 * 11. "A row's line 1 is the indicator, the name and the time. Line 2 is `waitingFor` or the
 *     state's words, plus the PR chip. The repo isn't on the row."
 * 12. "The time comes from `state.json`'s `updatedAt`. It reads `now` under a minute, then
 *     `Nm`, `Nh` and `Nd`, and updates within 60s. A missing or bad `updatedAt` shows no time,
 *     and logs once per session." (the logging is a cargo test)
 * 13. "Working shows the moving cell grid, and needs you breathes. Under reduced motion, both
 *     are still."
 *
 * The oracle is what each entry and job fake says. Every job is removed at the end.
 */
import type { ChainablePromiseElement } from "webdriverio";
import { attachable, fake, show } from "./helpers/app.js";

type Entry = Record<string, unknown>;
const iso = (agoMs: number) => new Date(Date.now() - agoMs).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const working = (id: string, repo: string, name: string): Entry => ({
  ...(attachable(id, { repo, name }) as Entry),
  state: "working",
  status: "busy",
  pid: 4242,
});
const blocked = (id: string, repo: string, name: string, waitingFor = "approve the plan"): Entry => ({
  ...(attachable(id, { repo, name }) as Entry),
  state: "blocked",
  status: "waiting",
  waitingFor,
});
const li = (repo: string, name: string) => $(`section[aria-label="${repo}"]`).$(`li*=${name}`);
const timeEl = (repo: string, name: string) => li(repo, name).$("time");

async function withJobs(ids: string[], body: () => Promise<void>) {
  try {
    await body();
  } finally {
    for (const id of ids) fake.job(id, null);
    await show("empty");
  }
}

type Box = { top: number; bottom: number; left: number; right: number; mid: number };
async function box(el: ChainablePromiseElement): Promise<Box> {
  await el.waitForExist({ timeout: 3000 });
  const node = (await el.getElement()) as unknown as HTMLElement;
  return browser.execute((n: HTMLElement) => {
    const r = n.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, mid: (r.top + r.bottom) / 2 };
  }, node);
}

describe("Slice 3: row lines (item 11)", () => {
  after(async () => {
    fake.job("rowl11", null);
    await show("empty");
  });

  it("11: line 1 is the indicator, the name and the time; line 2 is waitingFor plus the PR chip; the repo isn't on the row", async () => {
    await show([blocked("rowl11", "rowlayout", "linename", "approve the plan")]);
    fake.job("rowl11", { ...fake.prState([7]), updatedAt: iso(5 * MIN + 5000) });
    const row = li("rowlayout", "linename");
    await timeEl("rowlayout", "linename").waitForExist({ timeout: 5000, timeoutMsg: "no <time> on the row" });
    await $(`section[aria-label="rowlayout"] button[aria-label="PR #7"]`).waitForExist({ timeout: 5000 });

    const indicator = await box(row.$('[role="img"]'));
    const name = await box(row.$('.//*[text()="linename"]'));
    const time = await box(row.$("time"));
    const detail = await box(row.$('.//*[text()="approve the plan"]'));
    const chip = await box(row.$('button[aria-label="PR #7"]'));

    for (const b of [name, time]) expect(Math.abs(b.mid - indicator.mid)).toBeLessThan(6);
    expect(indicator.left).toBeLessThan(name.left);
    expect(name.left).toBeLessThan(time.left);
    expect(detail.top).toBeGreaterThanOrEqual(Math.max(indicator.bottom, name.bottom, time.bottom) - 2);
    expect(chip.top).toBeGreaterThanOrEqual(time.bottom - 2);
    // The time and the chip are right-aligned, the chip under the time.
    expect(Math.abs(chip.right - time.right)).toBeLessThan(8);
    expect(detail.left).toBeLessThan(time.left);

    const text = await row.getText();
    expect(text).not.toContain("rowlayout");
    expect(text).toContain("linename");
    expect(text).toContain("approve the plan");
  });

  it("11: with no waitingFor, line 2 is the state's words", async () => {
    await show([working("rowl11b", "rowwords", "wordsname")]);
    const row = li("rowwords", "wordsname");
    await row.waitForExist();
    const detail = await box(row.$('.//*[text()="working"]'));
    const name = await box(row.$('.//*[text()="wordsname"]'));
    expect(detail.top).toBeGreaterThanOrEqual(name.bottom - 2);
    expect(await row.getText()).not.toContain("rowwords");
  });

  it("11: a terminal-tab row says `run /bg to open here` on line 2", async () => {
    await show([{ pid: 777002, cwd: fake.repo("rowtab"), kind: "interactive", startedAt: 1790000000600, sessionId: "33333333-2222-3333-4444-555555555555", status: "busy", name: "tabname" }]);
    const row = li("rowtab", "tabname");
    await row.waitForExist();
    const detail = await box(row.$('.//*[contains(text(),"run /bg to open here")]'));
    const name = await box(row.$('.//*[text()="tabname"]'));
    expect(detail.top).toBeGreaterThanOrEqual(name.bottom - 2);
  });
});

describe("Slice 3: the time (item 12)", () => {
  const cases: [string, number, string][] = [
    ["12: under a minute reads `now`", 20_000, "now"],
    ["12: 3 minutes reads `3m`", 3 * MIN + 10_000, "3m"],
    ["12: 59 minutes reads `59m` (rounded down)", 59 * MIN + 50_000, "59m"],
    ["12: 2 hours reads `2h`", 2 * HOUR + 59 * MIN, "2h"],
    ["12: 3 days reads `3d`", 3 * DAY + 5 * HOUR, "3d"],
  ];
  for (const [title, ago, want] of cases) {
    it(title, async () => {
      await withJobs(["rowt12a"], async () => {
        const at = iso(ago);
        await show([working("rowt12a", "rowtime", "timename")]);
        fake.job("rowt12a", { children: [], updatedAt: at });
        await timeEl("rowtime", "timename").waitForExist({ timeout: 5000, timeoutMsg: "no <time>" });
        await expect(timeEl("rowtime", "timename")).toHaveText(want);
        expect(await timeEl("rowtime", "timename").getAttribute("datetime")).toBe(at);
      });
    });
  }

  it("12: a fraction-less UTC `Z` time is accepted", async () => {
    await withJobs(["rowt12b"], async () => {
      await show([working("rowt12b", "rowtimez", "znamez")]);
      fake.job("rowt12b", { children: [], updatedAt: iso(2 * HOUR + 10 * MIN).replace(/\.\d+Z$/, "Z") });
      await timeEl("rowtimez", "znamez").waitForExist({ timeout: 5000 });
      await expect(timeEl("rowtimez", "znamez")).toHaveText("2h");
    });
  });

  it("12: updatedAt changing in the file shows within a poll", async () => {
    await withJobs(["rowt12c"], async () => {
      await show([working("rowt12c", "rowtimechg", "chgname")]);
      fake.job("rowt12c", { children: [], updatedAt: iso(3 * MIN + 30_000) });
      await timeEl("rowtimechg", "chgname").waitForExist({ timeout: 5000 });
      await expect(timeEl("rowtimechg", "chgname")).toHaveText("3m");
      fake.job("rowt12c", { children: [], updatedAt: iso(2 * HOUR + 10 * MIN) });
      await browser.waitUntil(async () => (await timeEl("rowtimechg", "chgname").getText()) === "2h", {
        timeout: 3000,
        timeoutMsg: "the time did not change to 2h within 3s",
      });
    });
  });

  it("12: it reads `now` at 59.5s and `1m` within 60s", async function () {
    this.timeout(90_000);
    await withJobs(["rowt12d"], async () => {
      await show([working("rowt12d", "rowtimeage", "agename")]);
      fake.job("rowt12d", { children: [], updatedAt: iso(59_500) });
      await timeEl("rowtimeage", "agename").waitForExist({ timeout: 5000 });
      await expect(timeEl("rowtimeage", "agename")).toHaveText("now");
      const t0 = Date.now();
      await browser.waitUntil(async () => (await timeEl("rowtimeage", "agename").getText()) === "1m", {
        timeout: 60_000,
        interval: 500,
        timeoutMsg: "still not 1m after 60s",
      });
      expect(Date.now() - t0).toBeLessThan(60_000);
    });
  });

  const bad: [string, object | string | null][] = [
    ["a number", { children: [], updatedAt: 1790000000000 }],
    ["an offset", { children: [], updatedAt: "2026-10-04T23:17:49.030+01:00" }],
    ['"yesterday"', { children: [], updatedAt: "yesterday" }],
    ["an empty string", { children: [], updatedAt: "" }],
    ["a date with no time", { children: [], updatedAt: "2026-10-04" }],
    ["a missing key", { children: [] }],
    ["no state.json at all", null],
  ];
  for (const [what, content] of bad) {
    it(`12: a bad updatedAt (${what}) shows no time`, async () => {
      await withJobs(["rowt12e"], async () => {
        await show([working("rowt12e", "rowtimebad", "badname")]);
        if (content !== null) fake.job("rowt12e", content);
        await li("rowtimebad", "badname").waitForExist();
        await browser.pause(1500);
        expect((await li("rowtimebad", "badname").$$("time")).length).toBe(0);
      });
    });
  }

  it("12: a bad updatedAt replacing a good one removes the time", async () => {
    await withJobs(["rowt12f"], async () => {
      await show([working("rowt12f", "rowtimerm", "rmname")]);
      fake.job("rowt12f", { children: [], updatedAt: iso(3 * MIN + 30_000) });
      await timeEl("rowtimerm", "rmname").waitForExist({ timeout: 5000 });
      await expect(timeEl("rowtimerm", "rmname")).toHaveText("3m");
      fake.job("rowt12f", { children: [], updatedAt: "yesterday" });
      await browser.waitUntil(async () => (await li("rowtimerm", "rmname").$$("time")).length === 0, {
        timeout: 3000,
        timeoutMsg: "the <time> stayed",
      });
    });
  });
});

describe("Slice 3: motion (item 13)", () => {
  const anim = (sel: string) =>
    browser.execute((s: string) => {
      const el = document.querySelector(s) as HTMLElement;
      const cells = [...el.children].filter((c) => c.tagName === "SPAN") as HTMLElement[];
      return {
        name: getComputedStyle(el).animationName,
        running: el.getAnimations().length,
        cells: cells.map((c) => ({
          name: getComputedStyle(c).animationName,
          duration: getComputedStyle(c).animationDuration,
          running: c.getAnimations().length,
        })),
      };
    }, sel);
  const ind = (repo: string) => `section[aria-label="${repo}"] li [role="img"]`;

  afterEach(async () => {
    await browser.execute(() => {
      delete document.documentElement.dataset.motion;
    });
  });

  it("13: working shows nine moving cells (cell-wave, 0.75s)", async () => {
    await show([working("rowm13a", "rowmwork", "mwork")]);
    await $(ind("rowmwork")).waitForExist();
    const a = await anim(ind("rowmwork"));
    expect(a.cells.length).toBe(9);
    for (const c of a.cells) {
      expect(c.name).toBe("cell-wave");
      expect(c.duration).toBe("0.75s");
      expect(c.running).toBeGreaterThan(0);
    }
  });

  it("13: needs you breathes", async () => {
    await show([blocked("rowm13b", "rowmneed", "mneed")]);
    await $(ind("rowmneed")).waitForExist();
    const a = await anim(ind("rowmneed"));
    expect(a.name).toBe("breathe");
    expect(a.running).toBeGreaterThan(0);
  });

  it("13: done, failed, stopped and paused are still", async () => {
    const mk = (id: string, repo: string, over: Entry) => ({ ...(attachable(id, { repo, name: id }) as Entry), ...over });
    await show([
      mk("rowm13c", "rowmdone", { state: "done", status: "idle" }),
      mk("rowm13d", "rowmfail", { state: "failed", status: "idle" }),
      mk("rowm13e", "rowmstop", { state: "stopped" }),
      mk("rowm13f", "rowmpause", { state: "working", status: "idle" }),
    ]);
    for (const repo of ["rowmdone", "rowmfail", "rowmstop", "rowmpause"]) {
      await $(ind(repo)).waitForExist();
      const a = await anim(ind(repo));
      expect(`${repo}:${a.name}`).toBe(`${repo}:none`);
    }
  });

  it("13: under reduced motion, working cells and the needs-you dot are still", async () => {
    await show([working("rowm13g", "rowmrw", "mrw"), blocked("rowm13h", "rowmrn", "mrn")]);
    await $(ind("rowmrw")).waitForExist();
    await $(ind("rowmrn")).waitForExist();
    await browser.execute(() => {
      document.documentElement.dataset.motion = "reduce";
    });
    try {
      await browser.waitUntil(
        async () => {
          const a = await anim(ind("rowmrw"));
          const n = await anim(ind("rowmrn"));
          return a.cells.length === 9 && a.cells.every((c) => c.name === "none" && c.running === 0) && n.name === "none" && n.running === 0;
        },
        { timeout: 3000, timeoutMsg: "the indicators still animate under data-motion=reduce" },
      );
    } finally {
      await browser.execute(() => {
        delete document.documentElement.dataset.motion;
      });
    }
  });
});
