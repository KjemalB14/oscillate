/**
 * PLAN-sessions.md, Chapter 2 slice 2, acceptance item 10, quoted verbatim:
 *
 * "Each session shows a state dot, its name and `waitingFor`. Terminal-tab sessions
 * are dimmed, with "run /bg to open here". With no sessions, the empty state shows."
 *
 * Expected content is worked out from the fixtures themselves, never the snapshot:
 * - e2e/fixtures/all-states.json's a1working entry (cwd /Users/me/code/alpha) carries
 *   `name: "refactor the parser"` and no `waitingFor`. Its a2blocked entry (same cwd)
 *   carries `name: "fix the flaky test"` and `waitingFor: "approve Bash"`. Both carry an
 *   `id` and a `state`.
 * - Its last two entries carry neither an `id` nor a `state` (item 7: interactive
 *   entries report `null` state) -- e2e/README.md names these the fixture's "two
 *   terminal-tab entries". By cwd basename (item 9): pid 4242 (cwd .../code/alpha)
 *   lands in group "alpha" alongside a1working and a2blocked; pid 4241
 *   (cwd /Users/me/code) lands alone in group "code".
 * - e2e/fixtures/empty.json is `[]`: no entries at all.
 *
 * Each session's row is found by an exact piece of its own fixture data (its `name`,
 * `waitingFor`, or -- for the three entries with neither -- its `id`), then walked up
 * to its container, so the state dot and the other text found beside it are read from
 * the row that fixture data actually produced, not merely from anywhere on the page.
 *
 * (A bare `*=text` is WDIO's partial *link-text* selector and only ever matches an
 * `<a>`; it silently finds nothing here. `li*=text`, and the explicit relative xpath
 * `.//*[contains(text(),...)]` used below, both search all descendants and work.)
 */
import { show } from "./helpers/app.js";

function rowContaining(text: string) {
  return $(`//*[contains(text(),"${text}")]/..`);
}

function section(label: string) {
  return $(`section[aria-label="${label}"]`);
}

describe("sidebar rows show state, name and waitingFor; terminal-tab rows dim; empty state shows (item 10)", () => {
  it("shows a state dot and the session's name", async () => {
    await show("all-states");
    // a1working: name "refactor the parser".
    const row = rowContaining("refactor the parser");
    await expect(row).toBeExisting();
    const dot = row.$('[role="img"]');
    await expect(dot).toBeExisting();
    await browser.waitUntil(async () => !!(await dot.getAttribute("aria-label")), {
      timeoutMsg: "the state dot has no accessible name",
    });
  });

  it("shows exactly one state dot per session (9 fixture entries, 9 dots)", async () => {
    await show("all-states");
    // all-states.json has 9 entries top to bottom; a dot is a session's state marker,
    // so the nav must hold exactly one per entry -- no more, no fewer.
    await browser.waitUntil(
      async () =>
        (await $$('nav[aria-label="Sessions"] [role="img"]')).length === 9,
      {
        timeoutMsg: 'nav[aria-label="Sessions"] does not hold exactly 9 state dots',
      },
    );
  });

  it("names each dot after that session's own state, not a shared one", async () => {
    await show("all-states");
    // a1working (state "working") and a2blocked (state "blocked") are distinct
    // states; their dots' accessible names must differ, and a1working's must reflect
    // "working" specifically.
    const workingDot = await rowContaining("refactor the parser").$(
      '[role="img"]',
    );
    const blockedDot = await rowContaining("fix the flaky test").$(
      '[role="img"]',
    );
    const workingLabel = await workingDot.getAttribute("aria-label");
    const blockedLabel = await blockedDot.getAttribute("aria-label");
    expect(workingLabel).toContain("working");
    expect(workingLabel).not.toBe(blockedLabel);

    // a3done (state "done") and a4failed (state "failed") are also distinct; neither
    // carries a `name`, so each is found by its own `id`, the fallback fixture data
    // displayed in its place.
    const doneDot = await rowContaining("a3done").$('[role="img"]');
    const failedDot = await rowContaining("a4failed").$('[role="img"]');
    const doneLabel = await doneDot.getAttribute("aria-label");
    const failedLabel = await failedDot.getAttribute("aria-label");
    expect(doneLabel).not.toBe(failedLabel);
  });

  it("shows the session's waitingFor alongside its name", async () => {
    await show("all-states");
    // a2blocked: name "fix the flaky test", waitingFor "approve Bash".
    const row = rowContaining("fix the flaky test");
    await expect(row).toBeExisting();
    await expect(row.$('.//*[contains(text(),"approve Bash")]')).toBeExisting();
    const dot = row.$('[role="img"]');
    await expect(dot).toBeExisting();
  });

  it('dims each terminal-tab session and shows "run /bg to open here"', async () => {
    await show("all-states");
    // pid 4242 (id-less, state-less) sits in group "alpha" beside a1working/a2blocked.
    const alphaRows = await section("alpha").$$("li");
    let dimmedInAlpha = 0;
    for (const r of alphaRows) {
      if ((await r.getAttribute("aria-disabled")) === "true") {
        dimmedInAlpha++;
        await expect(
          r.$('.//*[contains(text(),"run /bg to open here")]'),
        ).toBeExisting();
      }
    }
    expect(dimmedInAlpha).toBe(1);

    // pid 4241 (id-less, state-less) sits alone in group "code".
    const codeRows = await section("code").$$("li");
    expect(codeRows.length).toBe(1);
    await expect(codeRows[0]).toHaveAttribute("aria-disabled", "true");
    await expect(
      codeRows[0].$('.//*[contains(text(),"run /bg to open here")]'),
    ).toBeExisting();
  });

  it("shows the empty state when there are no sessions", async () => {
    await show("empty");
    // empty.json is `[]`: no group can exist, and the sidebar must show something in
    // their place saying so, rather than an empty <nav>.
    await browser.waitUntil(async () => (await $$("section")).length === 0, {
      timeoutMsg: "a group region is still showing with no sessions",
    });
    await expect(
      $('nav[aria-label="Sessions"]').$('.//*[contains(text(),"No sessions")]'),
    ).toBeExisting();
  });
});
