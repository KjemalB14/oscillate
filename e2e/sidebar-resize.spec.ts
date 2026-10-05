/**
 * PLAN-ui-pass.md, Chapter 5 slice 2, acceptance item 9, quoted verbatim:
 *
 * "The sidebar's width persists across a relaunch, and stays within 208–400px. A
 * double-click on its edge resets it to 256. ⌃⌘S collapses and restores it. The
 * terminal refits after each change: its cols match the PTY's."
 *
 * Plus a claim the PLAN implies: ⌃⌘S never reaches the PTY.
 */
import { attachable, fake, relaunch, show } from "./helpers/app.js";

const nav = () => $('nav[aria-label="Sessions"]');
const handle = () => $('[role="separator"][aria-label="Resize sidebar"]');
const header = () => $('header[aria-label="Session"]');
const pane = (name: string) => $(`section.terminal-pane[aria-label="${name} terminal"]`);
const width = async () =>
  Math.round(
    await browser.execute(() => document.querySelector('nav[aria-label="Sessions"]')!.getBoundingClientRect().width),
  );

async function widthIs(n: number) {
  await browser.waitUntil(async () => (await width()) === n, {
    timeout: 3000,
    timeoutMsg: `sidebar never settled at ${n}`,
  });
  await browser.pause(350); // past the 200ms animation
  expect(await width()).toBe(n);
}

async function drag(dx: number) {
  await browser
    .action("pointer")
    .move({ origin: await handle(), x: 0, y: 0 })
    .down()
    .move({ origin: "pointer", x: dx, y: 0, duration: 100 })
    .up()
    .perform();
  await browser.pause(350);
}

/** Ctrl+Cmd+S, as a keydown on whatever has focus (the terminal's textarea if it does). */
async function chord() {
  await browser.execute(() => {
    const t = document.activeElement ?? document.body;
    t.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        code: "KeyS",
        keyCode: 83,
        ctrlKey: true,
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await browser.pause(350);
}

async function visibleToggle() {
  const shown = [];
  for (const b of await $$('button[aria-label="Toggle sidebar"]')) if (await b.isDisplayed()) shown.push(b);
  return shown;
}

async function refit(name: string, id: string) {
  await browser.waitUntil(
    async () => {
      const sizes = fake.sizes(id);
      if (!sizes.length) return false;
      return Number(await pane(name).getAttribute("data-cols")) === sizes[sizes.length - 1].cols;
    },
    { timeout: 1500, timeoutMsg: `${name}'s data-cols never matched the PTY's last size` },
  );
}

const id = "sbrs1a";
const name = "sbrsone";
const list = () => show([attachable(id, { repo: "sbrs-repo", name })]);

describe("Slice 2: the sidebar's width (item 9)", () => {
  before(async () => {
    await relaunch();
    await list();
    await $(`//li[.//*[text()="${name}"]]`).click();
    await pane(name).waitForDisplayed();
    await browser.waitUntil(() => fake.attaches(id).length > 0, { timeout: 3000 });
  });

  after(async () => {
    if ((await width()) === 0) await chord();
    await handle().doubleClick();
    await widthIs(256);
  });

  it("starts at the default 256, open, with one visible toggle and a handle on its edge", async () => {
    await widthIs(256);
    await expect(handle()).toHaveAttribute("aria-valuenow", "256");
    await expect(handle()).toHaveAttribute("aria-valuemin", "208");
    await expect(handle()).toHaveAttribute("aria-valuemax", "400");
    expect((await visibleToggle()).length).toBe(1);
  });

  it("dragging the edge resizes it, and the terminal refits to the PTY's cols", async () => {
    await drag(60);
    await widthIs(316);
    await expect(handle()).toHaveAttribute("aria-valuenow", "316");
    await refit(name, id);
  });

  it("stays within 208-400px however far it is dragged", async () => {
    await drag(1000);
    await widthIs(400);
    await refit(name, id);
    await drag(-1000);
    await widthIs(208);
    await expect(handle()).toHaveAttribute("aria-valuenow", "208");
    await refit(name, id);
  });

  it("a double-click on its edge resets it to 256, and the terminal refits", async () => {
    await handle().doubleClick();
    await widthIs(256);
    await refit(name, id);
  });

  it("Ctrl+Cmd+S collapses it to width 0 and restores it, the terminal refitting each time", async () => {
    await chord();
    await widthIs(0);
    await expect(nav()).toExist();
    expect((await visibleToggle()).length).toBe(1);
    await expect(header().$('button[aria-label="Toggle sidebar"]')).toBeDisplayed();
    await refit(name, id);
    await chord();
    await widthIs(256);
    expect((await visibleToggle()).length).toBe(1);
    await refit(name, id);
  });

  it("the Toggle sidebar button collapses and restores it too", async () => {
    await (await visibleToggle())[0].click();
    await widthIs(0);
    await (await visibleToggle())[0].click();
    await widthIs(256);
  });

  it("Ctrl+Cmd+S never reaches the PTY", async () => {
    await pane(name).waitForDisplayed();
    await browser.execute(() => (document.querySelector(".terminal-pane textarea") as HTMLElement | null)?.focus());
    const pid = fake.attaches(id).at(-1)!.pid;
    const before = fake.keys(id, pid).length;
    await chord();
    await widthIs(0);
    await chord();
    await widthIs(256);
    await browser.pause(500);
    expect(fake.keys(id, pid).length).toBe(before);
  });

  it("persists a non-default width across a relaunch", async () => {
    await drag(80);
    await widthIs(336);
    await relaunch();
    await list();
    await widthIs(336);
    await expect(handle()).toHaveAttribute("aria-valuenow", "336");
  });

  it("persists collapsed across a relaunch, and restores to the width it had", async () => {
    await chord();
    await widthIs(0);
    await relaunch();
    await list();
    await nav().waitForExist();
    await widthIs(0);
    await chord();
    await widthIs(336);
  });
});
