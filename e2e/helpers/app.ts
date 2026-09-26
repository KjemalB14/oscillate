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
