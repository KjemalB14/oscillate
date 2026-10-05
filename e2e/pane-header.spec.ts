/**
 * PLAN-ui-pass.md, Chapter 5 slice 2, acceptance item 8 (content only; the drag is by
 * hand), quoted verbatim:
 *
 * "The header names the selected session (name, repo, state, PR chip), and is empty with
 * nothing selected. Dragging its empty space moves the window."
 *
 * The oracle is the fixture: the entries `show()` gives the fake. The header is
 * `header[aria-label="Session"]`.
 */
import { attachable, fake, relaunch, show } from "./helpers/app.js";

const header = () => $('header[aria-label="Session"]');
const row = (name: string) => $(`//li[.//*[text()="${name}"]]`);
const count = async (sel: string) => (await header().$$(sel)).length;

async function select(name: string) {
  await row(name).waitForClickable({ timeoutMsg: `row ${name} never appeared` });
  await row(name).click();
}

describe("Slice 2: the pane header (item 8)", () => {
  it("is empty with nothing selected: no session name, no state, no PR button", async () => {
    await relaunch(); // a fresh app has nothing selected
    await show([attachable("phdr0a", { repo: "phdr-zero", name: "hdrzero" })]);
    await row("hdrzero").waitForExist();
    await expect(header()).toExist();
    expect(await header().getText()).not.toContain("hdrzero");
    expect(await count('[role="img"]')).toBe(0);
    expect(await count('button[aria-label^="PR #"]')).toBe(0);
    expect(await count('button[aria-label*="more PRs"]')).toBe(0);
  });

  it("names the selected session: its name, repo, and the state its row dot shows", async () => {
    await show([
      attachable("phdr1a", { repo: "phdr-one", name: "hdrone" }),
      {
        ...(attachable("phdr1b", { repo: "phdr-two", name: "hdrtwo" }) as object),
        state: "blocked",
        status: "waiting",
        waitingFor: "approve the plan",
      },
    ]);
    const states: string[] = [];
    for (const [name, repo] of [
      ["hdrone", "phdr-one"],
      ["hdrtwo", "phdr-two"],
    ]) {
      await select(name);
      await browser.waitUntil(async () => (await header().getText()).includes(name), {
        timeoutMsg: `header never named ${name}`,
      });
      expect(await header().getText()).toContain(repo);
      const rowState = await row(name).$('[role="img"]').getAttribute("aria-label");
      expect(rowState).toBeTruthy();
      states.push(rowState);
      await expect(header().$(`[role="img"][aria-label="${rowState}"]`)).toExist();
    }
    // The two sessions are in different states, so the header followed the selection.
    expect(states[0]).not.toBe(states[1]);
  });

  it("shows the newest PR as a chip, and +k when there are more", async () => {
    try {
      await show([attachable("phdr2a", { repo: "phdr-pr", name: "hdrpr" })]);
      fake.job("phdr2a", fake.prState([7, 8, 9]));
      await select("hdrpr");
      await browser.waitUntil(async () => header().$('button[aria-label="PR #9"]').isExisting(), {
        timeout: 4000,
        timeoutMsg: "no PR #9 chip in the header",
      });
      await expect(header().$('button[aria-label="PR #9"]')).toHaveText("#9");
      await expect(header().$('button[aria-label="2 more PRs from hdrpr"]')).toExist();
    } finally {
      fake.job("phdr2a", null);
      await show("empty");
    }
  });

  it("shows no PR chip for a session with no PRs", async () => {
    await show([attachable("phdr3a", { repo: "phdr-nopr", name: "hdrnopr" })]);
    await select("hdrnopr");
    await browser.waitUntil(async () => (await header().getText()).includes("hdrnopr"));
    expect(await count('button[aria-label^="PR #"]')).toBe(0);
  });
});
