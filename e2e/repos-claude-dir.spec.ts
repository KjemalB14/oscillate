/**
 * PLAN-new-sessions.md, Chapter 3 slice 2, acceptance item 11, verbatim:
 *
 * 11. "Nothing under the watched Claude dir is written. Over the slice's specs, the
 *     temp `OSCILLATE_CLAUDE_DIR` tree is unchanged by the app (invariant 5)."
 *
 * Named to sort after new-session.spec.ts and before sidebar-*.spec.ts, so in a full run
 * the baseline comparison covers the slice. It also does the slice's actions itself, so
 * it stands alone: "+" to start a session, "Add repo…", "Remove from list".
 */
import { attachable, fake, show } from "./helpers/app.js";

describe("nothing under the watched Claude dir is written (item 11)", () => {
  after(async () => {
    fake.pick(null);
    fake.answerBg({});
    await show("all-states");
  });

  it("11: '+', 'Add repo…' and 'Remove from list' leave the tree unchanged", async function () {
    this.timeout(60_000);
    const start = fake.claudeDirTree();

    // "+" starts a session.
    const repo = "rcd-repo";
    const id = "rcdnew1";
    fake.answerBg({ id });
    await show([attachable("rcd0", { repo })]);
    const bgs = fake.bgs().length;
    await $(`button[aria-label="New session in ${repo}"]`).click();
    await $(`[role="dialog"][aria-label="New session in ${repo}"]`).waitForDisplayed({ timeout: 3000 });
    await browser.execute(() => {
      const ta = document.querySelector('[role="dialog"] textarea') as HTMLTextAreaElement;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(ta, "hello");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await $('[role="dialog"] button[type="submit"]').click();
    await browser.waitUntil(() => fake.bgs().length > bgs, { timeout: 5000 });
    await show([attachable("rcd0", { repo }), attachable(id, { repo })]);
    await browser.waitUntil(() => fake.attaches(id).length > 0, { timeout: 5000, timeoutMsg: "the new session never attached" });
    await browser.waitUntil(async () => !(await $('[role="dialog"]').isExisting()), { timeout: 5000 });

    // "Add repo…", then "Remove from list".
    await show("empty");
    fake.pick(fake.repo("rcd-added"));
    await $("button*=Add repo").click();
    const g = $('section[aria-label="rcd-added"]');
    await g.waitForExist({ timeout: 2000 });
    expect(fake.reposJson()).toEqual([fake.repo("rcd-added")]);
    await g.$('button[aria-label="Remove from list"]').click();
    await browser.waitUntil(async () => !(await g.isExisting()), { timeout: 2000 });
    await browser.waitUntil(() => (fake.reposJson() ?? []).length === 0, { timeout: 2000 });
    await browser.pause(1000);

    expect(fake.claudeDirTree()).toEqual(start);
    expect(fake.claudeDirTree()).toEqual(fake.claudeDirBaseline());
  });
});
