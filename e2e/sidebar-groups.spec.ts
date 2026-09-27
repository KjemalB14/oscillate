/**
 * PLAN-sessions.md, Chapter 2 slice 2, acceptance item 9, quoted verbatim:
 *
 * "Sessions are grouped by `cwd` basename. Two repos with the same basename show a
 * disambiguating parent segment. Groups collapse and show their counts."
 *
 * Each group is a `section[aria-label]` region (confirmed against the accessibility
 * snapshot, `e2e/.results/snapshot.txt`); its header is a `button[aria-expanded]`
 * holding a leading (empty-text) span, then the label, then the count — the second and
 * third `span`s, `spans[1]` and `spans[2]`, once the button's children are read live
 * (the snapshot's own walker only lists a span when it carries text, so it never showed
 * the first one). Expected labels and counts are worked out below from the fixture
 * files themselves (`e2e/fixtures/all-states.json`, `e2e/fixtures/deep-collision.json`),
 * not read off the snapshot.
 */
import { show } from "./helpers/app.js";

function section(label: string) {
  return $(`section[aria-label="${label}"]`);
}

function header(label: string) {
  return section(label).$("button[aria-expanded]");
}

/** How many of a group's session rows (`li`) are currently displayed. */
async function displayedRows(label: string): Promise<number> {
  const rows = await section(label).$$("li");
  let shown = 0;
  for (const row of rows) {
    if (await row.isDisplayed()) shown++;
  }
  return shown;
}

describe("sidebar groups sessions by cwd basename (item 9)", () => {
  it("groups by basename, with a count for each group", async () => {
    await show("all-states");
    // all-states.json: three entries share cwd /Users/me/code/alpha (a1working,
    // a2blocked, and the id-less pid-4242 entry) -> "alpha": 3. Two share
    // /Users/me/code/gamma (a6idle, a7nolive) -> "gamma": 2. The lone interactive
    // entry at /Users/me/code stands alone -> "code": 1.
    const expected: Record<string, string> = { alpha: "3", gamma: "2", code: "1" };
    for (const [label, count] of Object.entries(expected)) {
      await expect(section(label)).toBeExisting();
      const spans = await header(label).$$("span");
      await expect(spans[1]).toHaveText(label);
      await expect(spans[2]).toHaveText(count);
    }
  });

  it("shows a disambiguating parent segment for two repos with the same basename", async () => {
    await show("all-states");
    // /Users/me/code/beta (a3done, a4failed) and /Users/me/other/beta (a5stopped)
    // both end in "beta": neither may be labeled bare "beta".
    await expect(section("code/beta")).toBeExisting();
    await expect(section("other/beta")).toBeExisting();
    await expect(section("beta")).not.toBeExisting();

    const codeBeta = await header("code/beta").$$("span");
    await expect(codeBeta[1]).toHaveText("code/beta");
    await expect(codeBeta[2]).toHaveText("2");

    const otherBeta = await header("other/beta").$$("span");
    await expect(otherBeta[1]).toHaveText("other/beta");
    await expect(otherBeta[2]).toHaveText("1");
  });

  it("goes past a single parent segment when that alone still collides", async () => {
    await show("deep-collision");
    // deep-collision.json: /Users/me/a/x/repo and /Users/me/b/x/repo share both the
    // basename "repo" and the immediate parent "x" -- one segment ("x/repo") would
    // still collide, so the label must reach the grandparent that differs.
    await expect(section("a/x/repo")).toBeExisting();
    await expect(section("b/x/repo")).toBeExisting();
    await expect(section("x/repo")).not.toBeExisting();
    await expect(section("repo")).not.toBeExisting();

    // /Users/me/code/solo has no collision and keeps its bare basename.
    await expect(section("solo")).toBeExisting();
    const solo = await header("solo").$$("span");
    await expect(solo[2]).toHaveText("1");
  });

  it("collapses a group on its header, and keeps showing its count", async () => {
    await show("all-states");
    const h = await header("gamma");
    await expect(h).toHaveAttribute("aria-expanded", "true");
    const before = await h.$$("span");
    await expect(before[2]).toHaveText("2"); // a6idle and a7nolive, per the fixture
    // both of gamma's rows (a6idle, a7nolive) are on screen before it collapses
    await browser.waitUntil(async () => (await displayedRows("gamma")) === 2, {
      timeoutMsg: "gamma should show its 2 rows before collapsing",
    });

    await h.click();
    await expect(h).toHaveAttribute("aria-expanded", "false");
    // collapsing hides every row the group had
    await browser.waitUntil(async () => (await displayedRows("gamma")) === 0, {
      timeoutMsg: "gamma's rows should be hidden once collapsed",
    });
    const after = await h.$$("span");
    await expect(after[2]).toHaveText("2"); // the count survives the collapse

    await h.click(); // leave the group expanded for the rest of the suite
    await expect(h).toHaveAttribute("aria-expanded", "true");
    await browser.waitUntil(async () => (await displayedRows("gamma")) === 2, {
      timeoutMsg: "gamma should show its 2 rows again once re-expanded",
    });
  });
});
