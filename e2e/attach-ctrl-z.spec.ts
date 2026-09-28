/**
 * PLAN-sessions.md, Chapter 2 slice 3, acceptance item 16, quoted verbatim:
 *
 * "Ctrl+Z detaches, and a click reattaches with exactly 1 new attach process."
 *
 * `press("Ctrl+Z")` sends the byte the fake's `attach` treats as a detach request
 * (`e2e/README.md`): it prints its own "[detached from <id>]", logs `detach <id>
 * pid=<n>`, and exits. "Detaches" is checked two ways: the pane shows the same message
 * ← leads to (`button*=Detached`, per item 15), and the OS agrees the process is
 * actually gone (`fake.running().attach`), not merely that the fake logged it.
 *
 * "A click reattaches with exactly 1 new attach process" is checked by count, twice
 * over: `fake.attaches(id)` must grow by exactly one, and `fake.running().attach.get(id)`
 * must hold exactly one pid, a fresh one -- with a pause after the first new attach
 * shows up, so a second, spurious one has a chance to appear before "exactly" is
 * asserted.
 */
import { attachable, fake, press, show } from "./helpers/app.js";

function rowContaining(text: string) {
  return $(`//*[contains(text(),"${text}")]/..`);
}

function pane(id: string) {
  return $(`section[aria-label="${id} terminal"]`);
}

// Hidden panes stay mounted in the pool, each possibly with its own Detached message,
// so a page-global `button*=Detached` could match a stale one from another session.
// Scoped to this session's own pane, it can't.
function detachButton(id: string) {
  return pane(id).$("button*=Detached");
}

describe("Ctrl+Z detaches, and a click reattaches with exactly 1 new attach process (item 16)", () => {
  it("Ctrl+Z detaches: the pane shows the message, and the attach process is gone", async () => {
    const id = "ctrlz1";
    await show([attachable(id, { repo: "ctrlzrepo1" })]);

    const row = rowContaining(id);
    await row.waitForExist();
    await row.waitForClickable();
    await row.click();
    await browser.waitUntil(async () => fake.attaches(id).length > 0, {
      timeout: 3000,
      timeoutMsg: "no attach after clicking the row",
    });
    const pid = fake.attaches(id)[0].pid;

    await press("Ctrl+Z");

    await detachButton(id).waitForExist({
      timeoutMsg: 'the pane never showed the "Detached" message after Ctrl+Z',
    });
    await browser.waitUntil(
      () => {
        const alive = fake.running().attach.get(id) ?? [];
        return !alive.includes(pid);
      },
      { timeoutMsg: `attach pid ${pid} is still alive after Ctrl+Z, per \`ps\`` },
    );
    // The fake's own record of the detach, not only the OS's.
    expect(fake.log()).toContain(`detach ${id} pid=${pid}`);
  });

  it("a click reattaches with exactly 1 new attach process", async () => {
    const id = "ctrlz2";
    await show([attachable(id, { repo: "ctrlzrepo2" })]);

    const row = rowContaining(id);
    await row.waitForExist();
    await row.waitForClickable();
    await row.click();
    await browser.waitUntil(async () => fake.attaches(id).length > 0, {
      timeout: 3000,
      timeoutMsg: "no attach after clicking the row",
    });
    const firstPid = fake.attaches(id)[0].pid;

    await press("Ctrl+Z");
    await detachButton(id).waitForExist({
      timeoutMsg: 'the pane never showed the "Detached" message after Ctrl+Z',
    });
    await browser.waitUntil(
      () => {
        const alive = fake.running().attach.get(id) ?? [];
        return !alive.includes(firstPid);
      },
      { timeoutMsg: `attach pid ${firstPid} is still alive after Ctrl+Z, per \`ps\`` },
    );

    const beforeReattach = fake.attaches(id).length;
    await detachButton(id).waitForClickable();
    await detachButton(id).click();
    await browser.waitUntil(async () => fake.attaches(id).length > beforeReattach, {
      timeout: 3000,
      timeoutMsg: "no new attach after clicking to reattach",
    });

    // Give a second, spurious attach every chance to show up before counting.
    await browser.pause(1000);

    expect(fake.attaches(id).length).toBe(beforeReattach + 1);
    const secondPid = fake.attaches(id)[fake.attaches(id).length - 1].pid;
    expect(secondPid).not.toBe(firstPid);
    expect(fake.running().attach.get(id)).toEqual([secondPid]);
  });
});
