/**
 * PLAN-ui-pass.md, Chapter 5 slice 4 "Motion", acceptance item 16, verbatim:
 *
 * 16. "The row menu, the PR menu, the remove confirm and the new-session box enter with the
 *     catalog's timings, read from CSS variables defined in one place. Under reduced motion,
 *     every duration is 0." (e2e on computed styles)
 *
 * The oracle is the catalog (--motion-* on the root). Each float's computed animation must
 * name the right keyframes and last exactly the variable's value. Overriding the variable
 * inline on the root and seeing the float follow proves nothing is hard-coded.
 */
import { attachable, fake, rightClick, show } from "./helpers/app.js";

const CATALOG: Record<string, number> = {
  "--motion-menu-in": 140,
  "--motion-dialog-in": 180,
  "--motion-fade-in": 500,
  "--motion-fade-quick": 150,
  "--motion-size": 200,
};
const REPO = "motnrepo";
const NAME = "motsess";
const PRNAME = "motpr";
const PRREPO = "motprrepo";

const row = (name: string) => $(`//li[.//*[text()="${name}"]]`);
const rowMenu = () => $(`[role="menu"][aria-label="${NAME} actions"]`);
const prMenu = () => $(`[role="menu"][aria-label="More PRs from ${PRNAME}"]`);
const confirm = () => $(`[role="group"][aria-label="Remove ${NAME}?"]`);
const dialog = () => $(`[role="dialog"][aria-label="New session in ${REPO}"]`);

type Anim = { name: string; ms: number };
/** Computed animation of the element matched by `sel` (an attribute selector; optional descendant). */
async function anim(sel: string, inner?: string): Promise<Anim> {
  return browser.execute(
    (s: string, i: string | null) => {
      let el = document.querySelector(s) as HTMLElement | null;
      if (el && i) el = el.querySelector(i) as HTMLElement | null;
      if (!el) return { name: "missing", ms: -1 };
      const cs = getComputedStyle(el);
      const first = (v: string) => v.split(",")[0].trim();
      const d = first(cs.animationDuration);
      const ms = d.endsWith("ms") ? parseFloat(d) : parseFloat(d) * 1000;
      return { name: first(cs.animationName), ms: Math.round(ms * 1000) / 1000 };
    },
    sel,
    inner ?? null,
  );
}
/** The variable in ms. WebKit may serialize a time as "0.14s" or "140ms", so compare numerically. */
const cssVar = async (name: string): Promise<number> => {
  const raw = await browser.execute((n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
  const ms = raw.endsWith("ms") ? parseFloat(raw) : raw.endsWith("s") ? parseFloat(raw) * 1000 : NaN;
  return Math.round(ms * 1000) / 1000;
};
const setVar = (name: string, v: string) =>
  browser.execute((n: string, val: string) => document.documentElement.style.setProperty(n, val), name, v);
const setReduce = (on: boolean) =>
  browser.execute((o: boolean) => {
    if (o) document.documentElement.dataset.motion = "reduce";
    else delete document.documentElement.dataset.motion;
  }, on);

const S = {
  rowMenu: `[role="menu"][aria-label="${NAME} actions"]`,
  prMenu: `[role="menu"][aria-label="More PRs from ${PRNAME}"]`,
  confirm: `[role="group"][aria-label="Remove ${NAME}?"]`,
  dialog: `[role="dialog"][aria-label="New session in ${REPO}"]`,
};

async function gone(el: ChainablePromiseElementLike) {
  await browser.waitUntil(async () => !(await el().isExisting()), { timeoutMsg: "float did not close" });
}
type ChainablePromiseElementLike = () => ReturnType<typeof $>;

async function openRowMenu() {
  await row(NAME).waitForExist({ timeoutMsg: "row never appeared" });
  await rightClick(row(NAME));
  await rowMenu().waitForExist();
}
async function closeEsc(el: ChainablePromiseElementLike) {
  await browser.keys(["Escape"]);
  if (await el().isExisting()) await $("main").click();
  await gone(el);
}
async function openPrMenu() {
  await $(`button[aria-label*="more PRs from ${PRNAME}"]`).waitForExist({ timeout: 4000 });
  await $(`button[aria-label*="more PRs from ${PRNAME}"]`).click();
  await prMenu().waitForExist();
}
async function openConfirm() {
  await openRowMenu();
  await rowMenu().$('[role="menuitem"]=Remove').click();
  await confirm().waitForExist();
}
async function closeConfirm() {
  await confirm().$("button=Cancel").click();
  await gone(confirm);
}
async function openBox() {
  await $(`button[aria-label="New session in ${REPO}"]`).click();
  await dialog().waitForExist();
}
async function closeBox() {
  await browser.keys(["Escape"]);
  if (await dialog().isExisting()) await dialog().$("button=Cancel").click();
  await gone(dialog);
}

/** [label, open, close, selector, inner, keyframes, variable] */
const FLOATS: [string, () => Promise<void>, () => Promise<void>, string, string | undefined, string, string][] = [
  ["row menu", openRowMenu, () => closeEsc(rowMenu), S.rowMenu, undefined, "menu-in", "--motion-menu-in"],
  ["PR menu", openPrMenu, () => closeEsc(prMenu), S.prMenu, undefined, "menu-in", "--motion-menu-in"],
  ["remove confirm", openConfirm, closeConfirm, S.confirm, undefined, "menu-in", "--motion-menu-in"],
  ["new-session box scrim", openBox, closeBox, S.dialog, undefined, "fade-in", "--motion-fade-quick"],
  ["new-session box panel", openBox, closeBox, S.dialog, "form", "dialog-in", "--motion-dialog-in"],
];

describe("Slice 4: motion (item 16)", () => {
  before(async () => {
    await show([
      attachable("motsess1", { repo: REPO, name: NAME }),
      attachable("motpr1", { repo: PRREPO, name: PRNAME }),
    ]);
    fake.job("motpr1", fake.prState([11, 12, 13]));
  });
  afterEach(async () => {
    await browser.execute(() => {
      delete document.documentElement.dataset.motion;
      for (const n of ["--motion-menu-in", "--motion-dialog-in", "--motion-fade-in", "--motion-fade-quick", "--motion-size"])
        document.documentElement.style.removeProperty(n);
    });
  });
  after(async () => {
    fake.job("motpr1", null);
    await show("empty");
  });

  it("the catalog is five variables on the root, in ms", async () => {
    for (const [n, ms] of Object.entries(CATALOG)) expect(await cssVar(n)).toBe(ms);
  });

  for (const [label, open, close, sel, inner, kf, v] of FLOATS) {
    it(`${label} enters as ${kf} for ${v}'s duration`, async () => {
      await open();
      const a = await anim(sel, inner);
      await close();
      expect(a.name).toBe(kf);
      expect(a.ms).toBe(CATALOG[v]);
    });
  }

  for (const [label, open, close, sel, inner, kf, v] of FLOATS) {
    if (!["--motion-menu-in", "--motion-dialog-in"].includes(v)) continue;
    it(`${label}: overriding ${v} on the root changes its duration (defined in one place)`, async () => {
      await setVar(v, "777ms");
      await open();
      const a = await anim(sel, inner);
      await close();
      expect(a.name).toBe(kf);
      expect(a.ms).toBe(777);
    });
  }

  it("under reduced motion, every catalog variable reads 0ms", async () => {
    await setReduce(true);
    for (const n of Object.keys(CATALOG)) expect(await cssVar(n)).toBe(0);
  });

  for (const [label, open, close, sel, inner] of FLOATS) {
    it(`under reduced motion, the ${label} has a duration of 0`, async () => {
      await setReduce(true);
      await open();
      const a = await anim(sel, inner);
      await close();
      expect(a.ms).toBe(0);
    });
  }
});
