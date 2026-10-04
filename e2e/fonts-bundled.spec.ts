/**
 * PLAN-ui-pass.md, slice 1, acceptance criterion 4, quoted:
 *
 * "Geist and JetBrains Mono load from the app's own bundle: `document.fonts` reports
 * both loaded from the app's URL, and the release bundle contains both files."
 *
 * The e2e half is the first clause. (The bundle-contents half is a build check, not
 * something a running debug app shows.) `document.fonts` reports a family as loaded; the
 * page's @font-face rules say where each face's bytes come from (WebKit's resource
 * timing is empty under the app's custom protocol, so it can't). Open a session first so
 * the terminal has rendered and its face has been requested.
 */
import { attachable, show } from "./helpers/app.js";

const ID = "fontsa1";

type Info = {
  origin: string;
  loaded: string[];
  sources: { family: string; urls: string[] }[];
  sidebarFamily: string;
};

async function info(): Promise<Info> {
  return browser.execute(() => {
    const loaded: string[] = [];
    document.fonts.forEach((f) => {
      if (f.status === "loaded") loaded.push(f.family.replace(/^["']|["']$/g, ""));
    });
    const sources: { family: string; urls: string[] }[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      const base = sheet.href ?? location.href;
      for (const rule of Array.from(sheet.cssRules)) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        const family = rule.style.getPropertyValue("font-family").replace(/["']/g, "");
        const src = rule.style.getPropertyValue("src");
        const urls = [...src.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => new URL(m[1], base).href);
        sources.push({ family, urls });
      }
    }
    const nav = document.querySelector('nav[aria-label="Sessions"]');
    return {
      origin: location.origin,
      loaded,
      sources,
      sidebarFamily: nav ? getComputedStyle(nav).fontFamily : "",
    };
  });
}

describe("Geist and JetBrains Mono load from the app's own bundle", () => {
  before(async () => {
    await show([attachable(ID, { repo: "fontsrepo", name: "fontsa1" })]);
    const row = $(`//*[contains(text(),"fontsa1")]/..`);
    await row.waitForClickable();
    await row.click();
    await $(`section[aria-label="${ID} terminal"] .xterm`).waitForExist();
    await browser.waitUntil(async () => (await info()).loaded.some((f) => /JetBrains Mono/i.test(f)), {
      timeout: 10_000,
      timeoutMsg: "document.fonts never reported a JetBrains Mono face as loaded",
    });
  });

  it("document.fonts reports Geist loaded", async () => {
    expect((await info()).loaded.some((f) => /Geist/i.test(f))).toBe(true);
  });

  it("document.fonts reports JetBrains Mono loaded", async () => {
    expect((await info()).loaded.some((f) => /JetBrains Mono/i.test(f))).toBe(true);
  });

  it("both families' font files are at the app's own URL, and serve", async () => {
    const { origin, sources } = await info();
    for (const re of [/Geist/i, /JetBrains Mono/i]) {
      const urls = sources.filter((s) => re.test(s.family)).flatMap((s) => s.urls);
      expect(urls.length).toBeGreaterThan(0);
      for (const u of urls) {
        expect(u.startsWith(`${origin}/`)).toBe(true);
        expect(u).toMatch(/\.woff2$/);
      }
      const sizes: number[] = await browser.execute(
        (list: string[]) =>
          Promise.all(list.map((u) => fetch(u).then((r) => (r.ok ? r.arrayBuffer().then((b) => b.byteLength) : -1)))),
        urls,
      );
      for (const n of sizes) expect(n).toBeGreaterThan(1000);
    }
  });

  it("the sidebar is set in Geist", async () => {
    expect((await info()).sidebarFamily).toMatch(/Geist/i);
  });
});
