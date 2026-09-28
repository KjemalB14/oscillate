/**
 * PLAN-sessions.md, Chapter 2 slice 3, acceptance item 22, quoted verbatim:
 *
 * "A dead pane is silent. After its PTY exits, mouse moves, clicks, wheel, focus
 * changes and keys send 0 bytes (checked with the keylogging fake)."
 *
 * The fake's `attach` turns on mouse (1000, 1006) and focus (1004) reporting as soon
 * as it starts, exactly as Claude's TUI does, and logs every byte it reads
 * (`e2e/README.md`). Confirmed live first (so "0 bytes after exit" proves something):
 * a click, a focus change and a key each land in the live pid's own key log with a
 * distinct, recognizable byte pattern -- an SGR mouse report (`ESC [ <`), a focus
 * report (`ESC [ O` / `ESC [ I`), and the literal typed byte.
 *
 * Wheel needed a different route: `browser.action('wheel')` is a documented
 * WebdriverIO/WebDriver action, but produced nothing at all through this embedded
 * Tauri driver -- not even a local scroll (`scrollTop` never moved) -- so this driver
 * doesn't forward it. A raw `WheelEvent` dispatched directly on the `.xterm` element
 * (`browser.execute`, no harness change) reached the live pty exactly like a real
 * wheel would (its own `ESC [ <` report, button 65), which is what this test uses.
 *
 * A dead process can't log, so "0 bytes" isn't provable by re-reading the dead pid's
 * own log (it trivially can't grow). The real check is a fresh observer: after the
 * PTY exits (← Ctrl+Z, `press()`), every kind of input is produced on the now-dead
 * pane (a bare mouse move, a click, a wheel, a focus-out then focus-in, and a key),
 * *then* the same session is reattached -- a new fake process, its own clean key log
 * (`fake.keys(id, newPid)`). That log must hold none of the dead-phase bytes: no SGR
 * mouse report (covers both the click and the wheel, which share the same `ESC [ <`
 * prefix), no focus-out report (a fresh attach can only ever gain focus first, never
 * lose focus it never had -- so a focus-out in its log could only be the dead phase's,
 * leaked), and not the exact character typed. A focus-*in* report is allowed in the
 * new log without failing the test: gaining focus on reattach is the one thing this
 * test itself does afterward, so it is explained, not a leak.
 *
 * The terminal area is targeted at its own element's live-measured center, not a
 * guessed fixed offset (confirmed live: the terminal keeps its normal size and the
 * "Detached — click to reattach" status bar is a separate ~32px strip below it, not
 * an overlay on top of it, but exactly where that boundary falls depends on the
 * window's current size) -- so every dead-phase action lands on the terminal, never
 * the message, and reattaching is a separate, later click on that message.
 *
 * The focus-away step is a direct `.blur()`, not a click on this session's own
 * sidebar row: found live that a row click always opens that session, so on an
 * already-detached one it reattaches -- correct app behavior, but not a focus-only
 * change, and not what this test wants mid-scenario.
 */
import { attachable, fake, press, show } from "./helpers/app.js";

function rowContaining(text: string) {
  return $(`//*[contains(text(),"${text}")]/..`);
}

function pane(id: string) {
  return $(`section[aria-label="${id} terminal"]`);
}

function detachButton(id: string) {
  return $(`//section[@aria-label="${id} terminal"]//button[contains(text(),"Detached")]`);
}

/**
 * The offset from the pane's own center to its `.xterm` element's center, measured
 * live rather than guessed as a fixed pixel count: the "Detached" status bar is a
 * separate strip below the terminal (confirmed live), but *where* that boundary
 * falls depends on the window's actual size, so a fixed offset landed on the button
 * once and reattached instead of clicking dead air. This is always inside the
 * terminal, whatever the window's current size.
 */
async function terminalOffset(id: string): Promise<{ x: number; y: number }> {
  return browser.execute((sel) => {
    const paneEl = document.querySelector(sel) as HTMLElement;
    const xtermEl = paneEl.querySelector(".xterm") as HTMLElement;
    const p = paneEl.getBoundingClientRect();
    const t = xtermEl.getBoundingClientRect();
    return { x: t.left + t.width / 2 - (p.left + p.width / 2), y: t.top + t.height / 2 - (p.top + p.height / 2) };
  }, `section[aria-label="${id} terminal"]`);
}

async function clickTerminal(id: string): Promise<void> {
  const { x, y } = await terminalOffset(id);
  await browser.action("pointer").move({ origin: pane(id), x, y }).down({ button: 0 }).up({ button: 0 }).perform();
}

async function moveOverTerminal(id: string): Promise<void> {
  const { x, y } = await terminalOffset(id);
  await browser.action("pointer").move({ origin: pane(id), x: x + 20, y }).perform();
}

/** A raw DOM WheelEvent on `.xterm`: `browser.action('wheel')` isn't forwarded by this driver. */
async function wheelOverTerminal(id: string): Promise<void> {
  await browser.execute((sel) => {
    const el = document.querySelector(`${sel} .xterm`) as HTMLElement | null;
    el?.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true }));
  }, `section[aria-label="${id} terminal"]`);
}

/**
 * A focus change away from the terminal, without a click: clicking this session's own
 * sidebar row again (the obvious way to "click elsewhere") turns out to reattach it
 * once it's detached -- a row click always opens that session, live or not, which is
 * correct app behavior but not what a focus-change test wants. Calling `.blur()`
 * directly fires the same DOM `blur` event xterm listens for, with no such side effect.
 */
async function blurTerminal(id: string): Promise<void> {
  await browser.execute((sel) => {
    const el = document.querySelector(`${sel} [aria-label="Terminal input"]`) as HTMLElement | null;
    el?.blur();
  }, `section[aria-label="${id} terminal"]`);
}

describe("a dead pane is silent (item 22)", () => {
  it("sends 0 bytes for mouse moves, clicks, wheel, focus changes and keys after its PTY exits", async () => {
    const id = "deadpane1";
    await show([attachable(id, { repo: "quietroom1" })]);

    const row = rowContaining(id);
    await row.waitForExist();
    await row.waitForClickable();
    await row.click();
    await browser.waitUntil(async () => fake.attaches(id).length > 0, {
      timeout: 8000,
      timeoutMsg: "no attach after clicking the row",
    });
    const pid1 = fake.attaches(id)[0].pid;
    await pane(id).waitForExist();

    // Live, first: prove the pipeline actually reaches the pty for each category.
    let mark = fake.keys(id, pid1).length;
    const since = () => {
      const all = fake.keys(id, pid1);
      const delta = all.slice(mark);
      mark = all.length;
      return delta;
    };

    await clickTerminal(id);
    expect(since().toString("hex")).toMatch(/^1b5b3c/); // SGR mouse report

    await wheelOverTerminal(id);
    expect(since().toString("hex")).toMatch(/^1b5b3c/); // SGR mouse report (wheel button)

    await blurTerminal(id); // focus away
    expect(since().toString("hex")).toBe("1b5b4f"); // ESC [ O, focus-out
    await clickTerminal(id); // focus back (+ another click's own report)
    expect(since().toString("hex")).toMatch(/^1b5b49/); // ESC [ I, focus-in (then the click)

    await press("x");
    expect(since().toString()).toBe("x");

    // Exit the PTY.
    await press("Ctrl+Z");
    await detachButton(id).waitForExist({ timeoutMsg: 'the "Detached" message never showed after Ctrl+Z' });
    await browser.waitUntil(() => !(fake.running().attach.get(id) ?? []).includes(pid1), {
      timeout: 3000,
      timeoutMsg: `attach pid ${pid1} is still alive per \`ps\` after Ctrl+Z`,
    });
    const pid1LogAtDeath = fake.keys(id, pid1).length;

    // Every kind of input, on the now-dead pane. All of it targets the terminal area,
    // well clear of the Detached message (confirmed live to be a separate strip below
    // it, not an overlay on top of it).
    await moveOverTerminal(id);
    await clickTerminal(id);
    await wheelOverTerminal(id);
    await blurTerminal(id); // focus out
    await clickTerminal(id); // focus back in (also the click that lets `press()` work)
    await press("y");

    // The dead pid, unsurprisingly, logged nothing more -- it can't.
    expect(fake.keys(id, pid1).length).toBe(pid1LogAtDeath);

    // The real check: reattach (a fresh process, its own clean log) and confirm none
    // of the dead-phase input leaked into it.
    await detachButton(id).click();
    await browser.waitUntil(async () => fake.attaches(id).length > 1, {
      timeout: 8000,
      timeoutMsg: "no new attach after clicking to reattach",
    });
    const pid2 = fake.attaches(id)[fake.attaches(id).length - 1].pid;
    expect(pid2).not.toBe(pid1);
    await browser.pause(500); // let any leaked/replayed bytes show up before checking

    const pid2Log = fake.keys(id, pid2);
    const pid2Hex = pid2Log.toString("hex");
    expect(pid2Hex).not.toContain("1b5b3c"); // no SGR mouse report: no click, no wheel leaked
    expect(pid2Hex).not.toContain("1b5b4f"); // no focus-out: a fresh attach can only gain focus, never lose it first
    expect(pid2Log.includes("y")).toBe(false); // the dead-phase key never arrived
  });
});
