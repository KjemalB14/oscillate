/**
 * PLAN-sessions.md, Chapter 2 slice 2, acceptance item 11, quoted verbatim:
 *
 * "A change in the fake `claude`'s output shows in the sidebar within 2.5s, or within
 * 0.5s of a touch in the watched directory."
 *
 * Two claims, each timed from the moment the fake's answer changes (`fake.setOut`),
 * never from when a poll happened to run (`e2e/README.md`: "Use them for timing
 * claims."):
 *   (a) `fake.setOut(...)` alone, with no touch -- bounded by the poll interval itself
 *       (slice 1 item 4: every 2s +/- 0.2s), so the criterion's 2.5s allows for the
 *       worst case where the change lands just after a poll already ran.
 *   (b) `fake.setOut(...)` then `fake.touch()` -- bounded by the watch re-poll (slice 1
 *       item 5: within 300ms of a touch), so the criterion's 0.5s allows for that plus
 *       render time.
 *
 * Each claim needs its own visible change, so each starts from a known baseline
 * (`show("empty")`, i.e. `e2e/fixtures/empty.json` -- no sessions) and then switches to
 * an inline single-entry array naming a `cwd` basename found nowhere else in this
 * suite's fixtures. By item 9 (grouping by `cwd` basename, already proved in
 * `sidebar-groups.spec.ts`), that basename must appear as its own
 * `section[aria-label=...]` once the app has picked up the change -- so the section's
 * existence is the observable "shows in the sidebar" the criterion asks for.
 */
import { fake, show } from "./helpers/app.js";

function section(label: string) {
  return $(`section[aria-label="${label}"]`);
}

function timingEntry(basename: string) {
  return [
    {
      pid: 5000,
      id: basename,
      cwd: `/Users/me/code/${basename}`,
      kind: "background",
      startedAt: 1790000000101,
      sessionId: `${basename}-0000-0000-0000-000000000000`,
      name: "timing check",
      status: "busy",
      state: "working",
    },
  ];
}

describe("a fake-claude output change shows in the sidebar on time (item 11)", () => {
  it("shows within 2.5s of fake.setOut alone, with no touch", async () => {
    await show("empty"); // known baseline: no sessions, so "timing-a" cannot exist yet
    await expect(section("timing-a")).not.toBeExisting();

    const start = Date.now();
    fake.setOut(timingEntry("timing-a")); // no fake.touch(): only the 2s poll can catch this
    await browser.waitUntil(async () => section("timing-a").isExisting(), {
      timeout: 2500,
      interval: 25,
      timeoutMsg: "the sidebar did not show the new session within 2.5s of fake.setOut, with no touch",
    });
    console.log(`item 11a: visible ${Date.now() - start}ms after fake.setOut, no touch`);
  });

  it("shows within 0.5s of fake.setOut followed by fake.touch", async () => {
    await show("empty"); // reset to the same known baseline
    await expect(section("timing-b")).not.toBeExisting();

    const start = Date.now();
    fake.setOut(timingEntry("timing-b"));
    fake.touch();
    await browser.waitUntil(async () => section("timing-b").isExisting(), {
      timeout: 500,
      interval: 25,
      timeoutMsg: "the sidebar did not show the new session within 0.5s of fake.setOut + fake.touch",
    });
    console.log(`item 11b: visible ${Date.now() - start}ms after fake.setOut + fake.touch`);
  });
});
