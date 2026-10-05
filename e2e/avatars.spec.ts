/**
 * PLAN-ui-pass.md, Chapter 5 slice 3 "Rows", acceptance item 14, verbatim:
 *
 * 14. "A repo with a GitHub origin shows its owner's avatar, fetched once and cached in the
 *     app data dir. A relaunch makes no request. No remote, a non-GitHub remote, offline, or
 *     a bad image each show the folder glyph, logged once per repo." (the logging is a
 *     cargo test)
 *
 * The oracle is the avatar server's request log and the fake's git configs. Each case uses
 * a fresh owner, because the app looks each owner up once per process.
 */
import { AvatarServer } from "./helpers/avatar-server.js";
import { attachable, fake, relaunch, show } from "./helpers/app.js";

type Entry = Record<string, unknown>;
const header = (label: string) => $(`section[aria-label="${label}"] button[aria-expanded]`);
const avatar = (label: string) => header(label).$("[data-avatar]");
const kind = async (label: string) => {
  await avatar(label).waitForExist({ timeout: 5000, timeoutMsg: `no avatar on ${label}` });
  return avatar(label).getAttribute("data-avatar");
};
/** Waits past "pending" and returns the settled kind. */
async function settled(label: string): Promise<string> {
  let k = "";
  await browser.waitUntil(
    async () => {
      k = (await kind(label)) ?? "";
      return k === "image" || k === "folder";
    },
    { timeout: 8000, timeoutMsg: `${label}'s avatar never settled (last: ${k})` },
  );
  return k;
}
const sess = (id: string, repo: string, cwd?: string): Entry => attachable(id, { repo, cwd }) as Entry;

let server: AvatarServer;

describe("Slice 3: the group avatar (item 14)", () => {
  before(async () => {
    server = await AvatarServer.start();
    fake.clearAvatarCache();
  });
  after(async () => {
    await server.stop();
    fake.pick(null);
    await show("empty");
  });

  it("14: a GitHub https origin shows the owner's avatar, fetched once and cached", async () => {
    fake.gitRepo("avhttps", "https://github.com/avownerone/avhttps.git");
    await show([sess("avs1", "avhttps")]);
    expect(await settled("avhttps")).toBe("image");
    const img = avatar("avhttps");
    expect(await img.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    await browser.waitUntil(async () => (await img.getProperty("naturalWidth")) === 8, { timeout: 3000, timeoutMsg: "the image never loaded at 8px" });
    expect(server.requests("avownerone").length).toBe(1);
    await browser.waitUntil(() => fake.avatarCache().includes("avownerone"), { timeout: 3000, timeoutMsg: "owner not in the cache dir" });
    // The children, in order: chevron span, avatar, label span, count span.
    const tags = await browser.execute(
      (el: HTMLElement) => [...el.children].map((c) => c.tagName.toLowerCase()),
      (await header("avhttps").getElement()) as unknown as HTMLElement,
    );
    expect(tags).toEqual(["span", "img", "span", "span"]);
  });

  it("14: an scp-style GitHub origin shows the avatar too", async () => {
    fake.gitRepo("avscp", "git@github.com:avownertwo/avscp.git");
    await show([sess("avs2", "avscp")]);
    expect(await settled("avscp")).toBe("image");
    expect(server.requests("avownertwo").length).toBe(1);
  });

  it("14: two repos with the same owner make one request", async () => {
    fake.gitRepo("avsame1", "https://github.com/avownerthree/avsame1.git");
    fake.gitRepo("avsame2", "git@github.com:avownerthree/avsame2.git");
    await show([sess("avs3a", "avsame1"), sess("avs3b", "avsame2")]);
    expect(await settled("avsame1")).toBe("image");
    expect(await settled("avsame2")).toBe("image");
    expect(server.requests("avownerthree").length).toBe(1);
  });

  it("14: a worktree shows its repo's owner's avatar", async () => {
    fake.gitRepo("avmain", "https://github.com/avownerfour/avmain.git");
    const wt = fake.gitWorktree("avmain", "avwt");
    await show([sess("avs4", "avmain", wt)]);
    expect(await settled("avwt")).toBe("image");
    expect(server.requests("avownerfour").length).toBe(1);
  });

  it("14: no remote shows the folder glyph", async () => {
    fake.gitRepo("avnoremote", null);
    await show([sess("avs5", "avnoremote")]);
    expect(await settled("avnoremote")).toBe("folder");
    expect((await avatar("avnoremote").getProperty("tagName")).toString().toLowerCase()).toBe("svg");
  });

  it("14: a non-GitHub remote shows the folder glyph and asks nobody", async () => {
    fake.gitRepo("avgitlab", "git@gitlab.com:avownerlab/avgitlab.git");
    const before = server.requests().length;
    await show([sess("avs6", "avgitlab")]);
    expect(await settled("avgitlab")).toBe("folder");
    expect(server.requests("avownerlab").length).toBe(0);
    expect(server.requests().length).toBe(before);
  });

  it("14: a directory that isn't a git repo shows the folder glyph", async () => {
    await show([sess("avs7", "avplain")]);
    expect(await settled("avplain")).toBe("folder");
  });

  for (const how of ["not-found", "html", "garbage"] as const) {
    it(`14: a bad image (${how}) shows the folder glyph`, async () => {
      fake.gitRepo(`avbad${how.replace("-", "")}`, `https://github.com/avbad${how.replace("-", "")}/x.git`);
      server.answer(`avbad${how.replace("-", "")}`, how);
      await show([sess(`avs8${how.length}`, `avbad${how.replace("-", "")}`)]);
      expect(await settled(`avbad${how.replace("-", "")}`)).toBe("folder");
      expect(server.requests(`avbad${how.replace("-", "")}`).length).toBe(1);
      expect(fake.avatarCache()).not.toContain(`avbad${how.replace("-", "")}`);
    });
  }

  it("14: offline shows the folder glyph", async () => {
    fake.gitRepo("avoffline", "https://github.com/avownerfive/avoffline.git");
    server.offline();
    try {
      await show([sess("avs9", "avoffline")]);
      expect(await settled("avoffline")).toBe("folder");
    } finally {
      server.online();
    }
    expect(server.requests("avownerfive").length).toBe(0);
  });

  it('14: an "Add repo…" group with no sessions gets its avatar', async () => {
    const dir = fake.gitRepo("avadded", "https://github.com/avownersix/avadded.git");
    await show("empty");
    fake.pick(dir);
    await $("button*=Add repo").click();
    try {
      expect(await settled("avadded")).toBe("image");
    } finally {
      await $('section[aria-label="avadded"] button[aria-label="Remove from list"]').click();
      await browser.waitUntil(() => (fake.reposJson() ?? []).length === 0, { timeout: 3000 });
    }
  });

  it("14: a relaunch makes no request and the image shows again from the cache", async function () {
    this.timeout(120_000);
    await show([sess("avs1", "avhttps")]);
    expect(await settled("avhttps")).toBe("image");
    const before = server.requests("avownerone").length;
    expect(fake.avatarCache()).toContain("avownerone");
    await relaunch();
    await show([sess("avs1", "avhttps")]);
    expect(await settled("avhttps")).toBe("image");
    expect(await avatar("avhttps").getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(server.requests("avownerone").length).toBe(before);
  });
});
