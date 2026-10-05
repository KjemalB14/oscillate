/**
 * The app under test, as the specs see it. One app runs for the whole suite (the service
 * launches it once), so a spec sets what the fake `claude` answers and waits for the app
 * to have polled it, rather than relaunching.
 */
import { execFileSync, spawn } from "node:child_process";
import { openSync } from "node:fs";
import { join } from "node:path";
import type { ChainablePromiseElement } from "webdriverio";
import { FakeClaude } from "./fake-claude.js";
import { ROOT } from "./results.js";

export const fake = FakeClaude.shared();

/** The e2e build of the app, as the service launches it. */
export const APP_BINARY = join(ROOT, "src-tauri", "target", "e2e", "debug", "oscillate");

/** The pids of every running e2e app (normally one). */
export function appPids(): number[] {
  const out = execFileSync("ps", ["-axo", "pid=,stat=,command="], { encoding: "utf8" });
  return out
    .split("\n")
    .map((l) => l.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/))
    .filter((m): m is RegExpMatchArray => !!m && !m[2].startsWith("Z") && (m[3] === APP_BINARY || m[3].startsWith(`${APP_BINARY} `)))
    .map((m) => Number(m[1]));
}

/**
 * Quits the app and launches it again, as a new process with the same environment
 * (so the same fake, watched dir and data dir), then opens a new WebDriver session on
 * it. Anything the app keeps only in memory is gone; `repos.json` is not. The old
 * process gets SIGTERM, so its PTYs close and their attaches get a hangup.
 */
export async function relaunch(): Promise<void> {
  const port = browser.options.port;
  if (!port) throw new Error("relaunch(): the WebDriver port isn't known");
  const old = appPids();
  for (const pid of old) process.kill(pid, "SIGTERM");
  await browser.waitUntil(() => appPids().every((p) => !old.includes(p)), {
    timeout: 10_000,
    timeoutMsg: `the app (pids ${old}) did not exit within 10s of SIGTERM`,
  });
  const log = openSync(join(fake.dir, "relaunch.log"), "a");
  const child = spawn(APP_BINARY, [], {
    env: { ...process.env, ...fake.appEnv(), TAURI_WEBDRIVER_PORT: String(port), WDIO_EMBEDDED_SERVER: "true" },
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/status`);
      if (res.ok) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error("relaunch(): the app's WebDriver server never came up");
    await new Promise((r) => setTimeout(r, 100));
  }
  await browser.reloadSession();
}

/**
 * Resolves once the app has run `claude agents` at least once after this call, so
 * whatever `fake.setOut` wrote before it has been read. Returns the ms it took.
 * The poll runs every 2s, or within ~100ms of `fake.touch()`.
 */
export async function nextPoll(timeoutMs = 3000): Promise<number> {
  const start = Date.now();
  const before = fake.polls();
  await browser.waitUntil(() => fake.polls() > before, {
    timeout: timeoutMs,
    interval: 25,
    timeoutMsg: `the app did not run \`claude agents\` within ${timeoutMs}ms`,
  });
  return Date.now() - start;
}

/**
 * Sets the fake's answer and waits for the app to have read it; the sidebar then updates
 * on the `sessions-changed` event that poll emits (if the list changed).
 */
export async function show(fixture: string | object[]): Promise<void> {
  fake.setOut(fixture);
  fake.touch();
  await nextPoll();
}

/**
 * A background session the app can attach, for `show([...])`: idle, named `name` (the
 * id by default), with its `cwd` a real directory from `fake.repo(repo)`. Ids must be
 * letters and digits, as real ones are; the app refuses anything else. `cwd` overrides
 * the directory, as for a `fake.gitWorktree()`.
 */
export function attachable(id: string, opts: { repo?: string; name?: string; cwd?: string } = {}): object {
  const seq = [...id].reduce((n, c) => n + c.charCodeAt(0), 0);
  return {
    id,
    cwd: opts.cwd ?? fake.repo(opts.repo ?? "repo"),
    kind: "background",
    startedAt: 1790000000000 + seq,
    sessionId: `${id}-0000-0000-0000-000000000000`,
    name: opts.name ?? id,
    status: "idle",
    state: "working",
  };
}

/** Keys as xterm.js reads them from a keydown. */
const KEYS = {
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  Enter: { key: "Enter", code: "Enter", keyCode: 13 },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  "Ctrl+Z": { key: "z", code: "KeyZ", keyCode: 90, ctrlKey: true },
  "Ctrl+C": { key: "c", code: "KeyC", keyCode: 67, ctrlKey: true },
  // In the running app the menu's accelerator takes Cmd+Q before the page sees it; the
  // page sends one it does see to the same quit command.
  "Cmd+Q": { key: "q", code: "KeyQ", keyCode: 81, metaKey: true },
} as const;

/** Key codes a keydown carries for punctuation; xterm.js ignores the character code. */
const PUNCTUATION: Record<string, number> = { "/": 191, ".": 190, ",": 188, "-": 189 };

/**
 * Presses keys in the focused terminal pane: names from `KEYS`, or any other string,
 * typed as its characters. Use this, not `browser.keys()`: this driver's key events carry
 * the character code as `keyCode`, so xterm.js reads `x` as F9 as well, and Ctrl+Z as
 * Ctrl+F11. Throws when no terminal has focus.
 */
export async function press(...keys: (keyof typeof KEYS | string)[]): Promise<void> {
  const events = keys.flatMap((k) =>
    k in KEYS
      ? [KEYS[k as keyof typeof KEYS]]
      : [...k].map((c) => ({ key: c, code: "", keyCode: PUNCTUATION[c] ?? c.toUpperCase().charCodeAt(0) })),
  );
  const error = await browser.execute((evs) => {
    const target = document.activeElement;
    if (!(target instanceof HTMLTextAreaElement) || !target.closest(".xterm")) {
      return `no terminal has focus (focus is on ${target?.tagName})`;
    }
    for (const init of evs) {
      target.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true }));
    }
    return null;
  }, events);
  if (error) throw new Error(`press(): ${error}`);
}

/**
 * Right-clicks `el` as WebKit does on macOS: `mousedown`, `contextmenu`, then `mouseup`,
 * all with button 2, at the element's center. Use this, not `click({ button: "right" })`:
 * this driver sends only the `mousedown` and `mouseup`, so no context menu ever opens.
 */
export async function rightClick(el: ChainablePromiseElement): Promise<void> {
  await el.waitForExist();
  const target = (await el.getElement()) as WebdriverIO.Element;
  const error = await browser.execute((node: HTMLElement) => {
    const r = node.getBoundingClientRect();
    const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    const hit = document.elementFromPoint(at.clientX, at.clientY);
    if (!hit || !(hit === node || node.contains(hit))) return `the element isn't under its own center (${hit?.tagName})`;
    const init = { ...at, button: 2, bubbles: true, cancelable: true, composed: true, view: window };
    hit.dispatchEvent(new MouseEvent("mousedown", { ...init, buttons: 2 }));
    hit.dispatchEvent(new MouseEvent("contextmenu", { ...init, buttons: 2 }));
    hit.dispatchEvent(new MouseEvent("mouseup", { ...init, buttons: 0 }));
    return null;
  }, target as unknown as HTMLElement);
  if (error) throw new Error(`rightClick(): ${error}`);
}

/**
 * Taps the app's notification for session `id`, as a click on a real banner would: it
 * runs the notification delegate's own handler, through an e2e-only command. Real
 * notifications can't appear in the e2e build, which has no app bundle.
 */
export async function tapNotification(id: string): Promise<void> {
  await notificationResponse(id, "tap");
}

/** Dismisses the app's notification for session `id`, as closing a real banner would. */
export async function dismissNotification(id: string): Promise<void> {
  await notificationResponse(id, "dismiss");
}

async function notificationResponse(id: string, action: "tap" | "dismiss"): Promise<void> {
  const error = await browser.execute(
    (id: string, action: string) => {
      const tauri = (window as unknown as { __TAURI__: { core: { invoke: (c: string, a: object) => Promise<unknown> } } }).__TAURI__;
      return tauri.core.invoke("e2e_notification_response", { id, action }).then(
        () => null,
        (e) => String(e),
      );
    },
    id,
    action,
  );
  if (error) throw new Error(`${action}Notification(${id}): ${error}`);
}
