/**
 * The app under test, as the specs see it. One app runs for the whole suite (the service
 * launches it once), so a spec sets what the fake `claude` answers and waits for the app
 * to have polled it, rather than relaunching.
 */
import { FakeClaude } from "./fake-claude.js";

export const fake = FakeClaude.shared();

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
 * letters and digits, as real ones are; the app refuses anything else.
 */
export function attachable(id: string, opts: { repo?: string; name?: string } = {}): object {
  const seq = [...id].reduce((n, c) => n + c.charCodeAt(0), 0);
  return {
    id,
    cwd: fake.repo(opts.repo ?? "repo"),
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
} as const;

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
      : [...k].map((c) => ({ key: c, code: "", keyCode: c.toUpperCase().charCodeAt(0) })),
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
