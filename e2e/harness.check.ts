/**
 * `npm run e2e:check`: the harness's own smoke test, not a criterion spec. It proves the
 * app launches under WebDriver, reads the fake `claude` (never the real one), and polls
 * again on a touch in the temp watched directory. Then that the fake `attach` logs its cwd
 * and its keys, and that `fake.running()` sees it. Then chapter 3's pieces: the fake
 * `--bg`, the folder-picker hook, `relaunch()`, the fake `stop` and `rm`, and that this
 * driver can right-click. Then chapter 4's: the notify log, the focus file, a
 * notification tap, a job's PR chip, and the opener log.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  appPids,
  attachable,
  dismissNotification,
  fake,
  nextPoll,
  press,
  relaunch,
  rightClick,
  show,
  tapNotification,
} from "./helpers/app.js";

describe("harness", () => {
  it("launches the app with a Sessions sidebar", async () => {
    await expect($('nav[aria-label="Sessions"]')).toBeExisting();
  });

  it("polls the fake claude, and only with the arguments the app is allowed", async () => {
    await nextPoll();
    expect(fake.polls()).toBeGreaterThan(0);
    expect(fake.log().filter((l) => l.startsWith("unexpected"))).toEqual([]);
  });

  it("re-polls within 500ms of a touch in the watched directory", async () => {
    await nextPoll(); // start just after a timed poll, so the next timed one is ~2s away
    fake.touch();
    expect(await nextPoll(500)).toBeLessThan(500);
  });

  it("shows what the fake answers", async () => {
    await show("empty");
    await expect($("nav[aria-label=\"Sessions\"]")).toHaveText(expect.stringContaining("No sessions"));
    await show("all-states");
  });
});

describe("harness: the fake attach", () => {
  it("logs the attach's cwd and every key, and shows in ps until Ctrl+Z", async () => {
    await show([attachable("hcheck1", { repo: "hcheck-repo" })]);
    await $("li*=hcheck1").click();
    await browser.waitUntil(() => fake.attaches("hcheck1").length === 1, { timeoutMsg: "no attach" });
    const [attach] = fake.attaches("hcheck1");
    expect(attach.cwd).toBe(fake.repo("hcheck-repo"));
    expect(fake.running().attach.get("hcheck1")).toEqual([attach.pid]);

    await press("x");
    await browser.waitUntil(() => fake.keys("hcheck1").toString() === "\x1b[Ix", { timeoutMsg: "no keys" });
    await press("Ctrl+Z");
    await browser.waitUntil(() => !fake.running().attach.has("hcheck1"), { timeoutMsg: "still running" });
    expect(fake.log()).toContain(`detach hcheck1 pid=${attach.pid}`);
    expect(fake.attachExits("hcheck1")).toEqual([
      { id: "hcheck1", pid: attach.pid, at: expect.any(Number), how: "detach" },
    ]);
    await show("all-states");
  });
});

describe("harness: the fake stop and rm", () => {
  it("logs argv, time and live attaches, and acts on the list as the daemon would", () => {
    const cwd = fake.repo("hcheck-end");
    fake.setOut([
      { ...attachable("hend1", { repo: "hcheck-end" }), status: "busy" },
      attachable("hend2", { repo: "hcheck-end" }),
    ]);
    const run = (...args: string[]) => {
      try {
        return { exit: 0, out: execFileSync(fake.bin, args, { cwd, encoding: "utf8", stdio: "pipe" }) };
      } catch (e) {
        const err = e as { status: number; stdout: string };
        return { exit: err.status, out: err.stdout };
      }
    };
    const listed = () => JSON.parse(readFileSync(join(fake.dir, "out"), "utf8")) as { id: string; state: string }[];

    expect(run("stop", "hend1")).toEqual({ exit: 0, out: "stopped hend1\n" });
    expect(listed().find((e) => e.id === "hend1")?.state).toBe("stopped");
    expect(fake.stops().at(-1)).toMatchObject({ cwd, argv: ["stop", "hend1"], attached: [] });

    fake.answerRm({ exit: 1 });
    expect(run("rm", "hend2")).toEqual({ exit: 1, out: fake.rmRefusal("hend2") });
    expect(listed().map((e) => e.id)).toEqual(["hend1", "hend2"]);
    fake.answerRm();
    expect(run("rm", "hend2")).toEqual({ exit: 0, out: "removed hend2\n" });
    expect(listed().map((e) => e.id)).toEqual(["hend1"]);
    expect(fake.rms().map((r) => r.argv)).toEqual([["rm", "hend2"], ["rm", "hend2"]]);
    expect(run("rm", "gone1").exit).toBe(1);
    fake.setOut("all-states");
  });

  it("sees a live attach from stop", async () => {
    await show([attachable("hend3", { repo: "hcheck-end" })]);
    await $("li*=hend3").click();
    await browser.waitUntil(() => fake.attaches("hend3").length === 1, { timeoutMsg: "no attach" });
    const [attach] = fake.attaches("hend3");
    execFileSync(fake.bin, ["stop", "hend3"], { cwd: fake.repo("hcheck-end") });
    expect(fake.stops().at(-1)?.attached).toEqual([attach.pid]);
    // Unlisted, the app hangs its attach up; the fake logs that exit, then dies of it.
    await show("all-states");
    await browser.waitUntil(() => !fake.running().attach.has("hend3"), { timeoutMsg: "still running" });
    expect(fake.attachExits("hend3")).toEqual([
      { id: "hend3", pid: attach.pid, at: expect.any(Number), how: "signal-HUP" },
    ]);
  });
});

describe("harness: a right-click", () => {
  it("rightClick() reaches the element as WebKit's mousedown, contextmenu and mouseup", async () => {
    await browser.execute(() => {
      const w = window as unknown as { __ev: string[] };
      w.__ev = [];
      for (const t of ["mousedown", "contextmenu", "mouseup"]) {
        document.addEventListener(
          t,
          (e) => {
            const m = e as MouseEvent;
            w.__ev.push(`${t}:${m.button}:${(m.target as HTMLElement).closest("button")?.textContent}`);
            if (t === "contextmenu") e.preventDefault();
          },
          { capture: true, once: true },
        );
      }
    });
    await rightClick($("button*=Add repo"));
    const seen = await browser.execute(() => (window as unknown as { __ev: string[] }).__ev);
    expect(seen).toEqual(["mousedown:2:Add repo…", "contextmenu:2:Add repo…", "mouseup:2:Add repo…"]);
  });
});

describe("harness: notifications", () => {
  it("logs a post on a transition, and a tap opens the session through the delegate's handler", async () => {
    const working = attachable("hnote1", { repo: "hcheck-note" });
    await show([working]);
    const from = fake.notifications().length;
    await show([{ ...working, state: "blocked", status: "waiting", waitingFor: "approve Bash" }]);
    // The badge line follows the post, from the same poll.
    await browser.waitUntil(
      () => fake.notifications().slice(from).some((n) => n.op === "badge" && n.count === 1),
      { timeoutMsg: "no post and badge logged" },
    );
    expect(fake.notifications().slice(from)).toContainEqual(
      expect.objectContaining({ op: "post", id: "hnote1", body: "approve Bash", subtitle: "hcheck-note" }),
    );
    expect(fake.notifications().slice(from)).toContainEqual(expect.objectContaining({ op: "badge", count: 1 }));

    await dismissNotification("hnote1");
    await tapNotification("hnote1");
    await browser.waitUntil(() => fake.attaches("hnote1").length === 1, { timeoutMsg: "the tap opened nothing" });
    expect(fake.notifications().slice(from)).toContainEqual(expect.objectContaining({ op: "remove", id: "hnote1" }));
    await press("Ctrl+Z");
    await browser.waitUntil(() => !fake.running().attach.has("hnote1"), { timeoutMsg: "still running" });
    await show("all-states");
  });

  it("reads the focus file", () => {
    fake.focus("background");
    expect(readFileSync(join(fake.dir, "focus"), "utf8")).toBe("background");
    fake.focus("key");
  });
});

describe("harness: PR links", () => {
  it("fake.job() writes a state.json the app reads, and a chip click reaches the opener log", async () => {
    const session = attachable("hpr1", { repo: "hcheck-pr" });
    fake.job("hpr1", fake.prState([7, 8]));
    await show([session]);
    await $('button[aria-label="PR #8"]').waitForExist({ timeoutMsg: "no chip" });
    const before = fake.opened().length;
    await $('button[aria-label="PR #8"]').click();
    await browser.waitUntil(() => fake.opened().length > before, { timeoutMsg: "nothing opened" });
    expect(fake.opened().slice(before)).toEqual(["https://github.com/example/repo/pull/8"]);
    expect(fake.claudeDirTree()).toEqual(fake.claudeDirExpected());
    fake.job("hpr1", null);
    await show("all-states");
    expect(fake.claudeDirTree()).toEqual(fake.claudeDirBaseline());
  });
});
