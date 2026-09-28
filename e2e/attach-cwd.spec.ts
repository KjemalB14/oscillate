/**
 * PLAN-sessions.md, Chapter 2 slice 3, acceptance item 13, quoted verbatim:
 *
 * "Attach runs in the session's `cwd`. `lsof -p <attach pid>` shows that directory.
 * With the directory removed, the click shows a message and spawns nothing."
 *
 * Two claims:
 * - A click on an attachable session (`attachable()`: a real directory from
 *   `fake.repo()`) starts the fake's `attach`, and the pid the fake logged
 *   (`fake.attaches(id)`, from its own `cwd=<dir>` line) is corroborated independently
 *   by asking the OS itself, `lsof -p <pid> -d cwd`, for that same process's current
 *   working directory -- it must be exactly the directory `attachable()` built the
 *   entry around.
 * - A click on a session whose `cwd` has been removed after the list was shown (so the
 *   directory existed when the entry was built, then stopped existing before the
 *   click) must show some message in its place, and must start nothing: neither a new
 *   line in the fake's log (`fake.attaches(id)`, which only grows on a real `attach`),
 *   nor a live process the OS can see (`fake.running().attach`).
 *
 * Each case uses its own id and repo name (letters and digits only, per `attachable()`),
 * unique to this spec, since one app serves the whole suite.
 */
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { attachable, fake, show } from "./helpers/app.js";

function rowContaining(text: string) {
  return $(`//*[contains(text(),"${text}")]/..`);
}

/** The `cwd` `lsof` reports for a live pid, resolved (`/private/var`, not `/var`), as
 * `fake.repo()` already is. */
function lsofCwd(pid: number): string {
  const out = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8" });
  const line = out.split("\n").find((l) => l.startsWith("n"));
  if (!line) throw new Error(`lsof -p ${pid} -d cwd reported no cwd (output: ${JSON.stringify(out)})`);
  return line.slice(1);
}

describe("attach runs in the session's cwd (item 13)", () => {
  it("lsof -p <attach pid> shows that directory", async () => {
    const id = "atcwdlive1";
    const repoDir = fake.repo("atcwdliverepo1");
    await show([attachable(id, { repo: "atcwdliverepo1" })]);

    await rowContaining(id).click();
    await browser.waitUntil(async () => fake.attaches(id).length > 0, {
      timeout: 3000,
      timeoutMsg: `the fake never logged an attach for ${id}`,
    });
    const pid = fake.attaches(id)[0].pid;

    expect(lsofCwd(pid)).toBe(repoDir);
  });

  it("with the directory removed, the click shows a message and spawns nothing", async () => {
    const id = "atcwdgone1";
    const repoDir = fake.repo("atcwdgonerepo1");
    await show([attachable(id, { repo: "atcwdgonerepo1" })]);
    rmSync(repoDir, { recursive: true, force: true }); // existed when shown; gone before the click

    const before = fake.attaches(id).length;
    await rowContaining(id).click();

    // The criterion's "shows a message": some text appears in place of nothing. It
    // must at least say the directory is gone; its exact wording is the app's own,
    // not asserted here.
    await browser.waitUntil(
      async () => $('.//*[contains(text(),"no longer exists")]').isExisting(),
      { timeoutMsg: 'no message about the missing directory appeared after the click' },
    );

    // "spawns nothing": no new line in the fake's log, and the OS agrees nothing is
    // alive for this id.
    expect(fake.attaches(id).length).toBe(before);
    expect(fake.running().attach.get(id) ?? []).toEqual([]);
  });
});
