/**
 * PLAN-new-sessions.md, Chapter 3 slice 2, acceptance items 9 and 10, verbatim:
 *
 * 9. ""Add repo…" adds a group. With the picker answered by a test hook, the chosen
 *    directory shows as a group with 0 sessions and a "+" within 0.5s. It's still there
 *    after an app relaunch. Adding the same directory twice, or through a symlink, gives
 *    one group. Adding a directory that already has sessions gives one group."
 * 10. ""Remove from list" works on added groups only. It removes a 0-session added
 *     group within 0.5s, and removes it from `repos.json`. On an added group with
 *     sessions, the group stays. Groups that come only from sessions have no such item."
 *
 * Every repo added here is removed before the spec ends (repos.json outlives specs).
 */
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachable, fake, relaunch, show } from "./helpers/app.js";

const group = (label: string) => $(`section[aria-label="${label}"]`);
const removeBtn = (label: string) => group(label).$('button[aria-label="Remove from list"]');
const addRepo = () => $("button*=Add repo");
const groupCount = async (label: string) => (await $$(`section[aria-label="${label}"]`)).length;

async function add(dir: string) {
  fake.pick(dir);
  await addRepo().click();
}

/** Leaves no added repo behind: lists nothing, then removes every remaining added group. */
async function removeAllAdded() {
  await show("empty");
  for (let i = 0; i < 10; i++) {
    const btn = await $('button[aria-label="Remove from list"]');
    if (!(await btn.isExisting())) break;
    await btn.click();
    await browser.pause(300);
  }
  await browser.waitUntil(() => (fake.reposJson() ?? []).length === 0, { timeout: 3000, timeoutMsg: "repos.json still lists repos" });
}

describe('"Add repo…" adds a group (item 9)', () => {
  afterEach(async () => {
    fake.pick(null);
    await removeAllAdded();
  });
  after(async () => {
    fake.pick(null);
    await removeAllAdded();
    await show("all-states");
  });

  it("9: the chosen directory shows as a group with 0 sessions and a \"+\" within 0.5s", async () => {
    await show("empty");
    const dir = fake.repo("ar-zero");
    await add(dir);
    const t0 = Date.now();
    await group("ar-zero").waitForExist({ timeout: 500 });
    await $('button[aria-label="New session in ar-zero"]').waitForExist({ timeout: 500 });
    expect(Date.now() - t0).toBeLessThan(700);
    await expect(group("ar-zero").$("button[aria-expanded]")).toHaveText(expect.stringContaining("0"));
    expect(await group("ar-zero").$$("li").length).toBe(0);
    expect(fake.reposJson()).toEqual([dir]);
  });

  it("9: it is still there after an app relaunch", async function () {
    this.timeout(60_000);
    await show("empty");
    await add(fake.repo("ar-persist"));
    await group("ar-persist").waitForExist({ timeout: 1000 });
    await relaunch();
    await group("ar-persist").waitForExist({ timeout: 5000, timeoutMsg: "group gone after relaunch" });
    await $('button[aria-label="New session in ar-persist"]').waitForExist({ timeout: 2000 });
    expect(fake.reposJson()).toEqual([fake.repo("ar-persist")]);
  });

  it("9: adding the same directory twice gives one group", async () => {
    await show("empty");
    const dir = fake.repo("ar-twice");
    await add(dir);
    await group("ar-twice").waitForExist({ timeout: 1000 });
    await add(dir);
    await browser.pause(1000);
    expect(await groupCount("ar-twice")).toBe(1);
    expect(await $$("nav[aria-label='Sessions'] section").length).toBe(1);
    expect(fake.reposJson()).toEqual([dir]);
  });

  it("9: adding it through a symlink gives one group", async () => {
    await show("empty");
    const real = fake.repo("ar-real");
    const link = join(mkdtempSync(join(tmpdir(), "ar-link-")), "ar-linked");
    symlinkSync(real, link);
    await add(real);
    await group("ar-real").waitForExist({ timeout: 1000 });
    await add(link);
    await browser.pause(1000);
    expect(await $$("nav[aria-label='Sessions'] section").length).toBe(1);
    expect(await groupCount("ar-real")).toBe(1);
    expect(await groupCount("ar-linked")).toBe(0);
    expect(fake.reposJson()).toEqual([real]);
  });

  it("9: a symlink added first still gives one group with the canonical path", async () => {
    await show("empty");
    const real = fake.repo("ar-real2");
    const link = join(mkdtempSync(join(tmpdir(), "ar-link-")), "ar-linked2");
    symlinkSync(real, link);
    await add(link);
    await group("ar-real2").waitForExist({ timeout: 1000 });
    await add(real);
    await browser.pause(1000);
    expect(await $$("nav[aria-label='Sessions'] section").length).toBe(1);
    expect(fake.reposJson()).toEqual([real]);
  });

  it("9: adding a directory that already has sessions gives one group", async () => {
    await show([attachable("arhas1", { repo: "ar-has" }), attachable("arhas2", { repo: "ar-has" })]);
    await group("ar-has").waitForExist({ timeout: 3000 });
    await add(fake.repo("ar-has"));
    await browser.waitUntil(async () => (fake.reposJson() ?? []).length === 1, { timeout: 2000 });
    await browser.pause(1000);
    expect(await groupCount("ar-has")).toBe(1);
    expect(await $$("nav[aria-label='Sessions'] section").length).toBe(1);
    expect(await group("ar-has").$$("li").length).toBe(2);
  });

  it("9: cancelling the picker adds nothing", async () => {
    await show("empty");
    fake.pick(null);
    await addRepo().click();
    await browser.pause(700);
    expect(await $$("nav[aria-label='Sessions'] section").length).toBe(0);
    expect(fake.reposJson() ?? []).toEqual([]);
  });
});

describe('"Remove from list" works on added groups only (item 10)', () => {
  afterEach(async () => {
    fake.pick(null);
    await removeAllAdded();
  });
  after(async () => {
    fake.pick(null);
    await removeAllAdded();
    await show("all-states");
  });

  it("10: it removes a 0-session added group within 0.5s, and from repos.json", async () => {
    await show("empty");
    await add(fake.repo("ar-rm"));
    await group("ar-rm").waitForExist({ timeout: 1000 });
    expect(fake.reposJson()).toEqual([fake.repo("ar-rm")]);
    await removeBtn("ar-rm").click();
    const t0 = Date.now();
    await browser.waitUntil(async () => !(await group("ar-rm").isExisting()), { timeout: 500, timeoutMsg: "group still shown 0.5s after Remove from list" });
    expect(Date.now() - t0).toBeLessThan(700);
    await browser.waitUntil(() => (fake.reposJson() ?? []).length === 0, { timeout: 500, timeoutMsg: "repos.json still has it" });
    expect(fake.reposJson()).toEqual([]);
  });

  it("10: on an added group with sessions, the group stays", async () => {
    await show([attachable("arkeep1", { repo: "ar-keep" })]);
    await add(fake.repo("ar-keep"));
    await browser.waitUntil(async () => (fake.reposJson() ?? []).length === 1, { timeout: 2000 });
    const btn = removeBtn("ar-keep");
    if (await btn.isExisting()) await btn.click();
    await browser.pause(1500);
    expect(await groupCount("ar-keep")).toBe(1);
    expect(await group("ar-keep").$$("li").length).toBe(1);
  });

  it("10: groups that come only from sessions have no such item", async () => {
    await show("all-states");
    await group("alpha").waitForExist({ timeout: 3000 });
    expect(await $$("nav[aria-label='Sessions'] section").length).toBeGreaterThan(1);
    expect(await $$('nav[aria-label="Sessions"] button[aria-label="Remove from list"]').length).toBe(0);
    expect(await $$('nav[aria-label="Sessions"] [role="menuitem"]').length).toBe(0);
  });
});
