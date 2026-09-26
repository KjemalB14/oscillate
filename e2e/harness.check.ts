/**
 * `npm run e2e:check`: the harness's own smoke test, not a criterion spec. It proves the
 * app launches under WebDriver, reads the fake `claude` (never the real one), and polls
 * again on a touch in the temp watched directory.
 */
import { fake, nextPoll, show } from "./helpers/app.js";

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
