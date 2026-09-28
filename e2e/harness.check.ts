/**
 * `npm run e2e:check`: the harness's own smoke test, not a criterion spec. It proves the
 * app launches under WebDriver, reads the fake `claude` (never the real one), and polls
 * again on a touch in the temp watched directory. Then that the fake `attach` logs its cwd
 * and its keys, and that `fake.running()` sees it.
 */
import { attachable, fake, nextPoll, press, show } from "./helpers/app.js";

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
    await show("all-states");
  });
});
