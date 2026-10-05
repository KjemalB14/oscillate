/**
 * `npm run e2e:speed`: the speed gate (`PLAN-ui-pass.md`, criterion 23). A probe, not a
 * criterion spec, so it's harness and not `e2e-author`'s, and the suite never runs it.
 *
 * It replays `fixtures/claude-turn.json` (a real turn recorded with `script -r`, scrubbed
 * by `.claude/scripts/scrub-recording`) into a fresh terminal under each renderer, via
 * `src/bench.ts`: WebGL at alpha 1, DOM at the look's alpha. It fails if DOM drains the
 * turn more than 2× slower than WebGL, or stalls a frame over 100 ms when the turn is
 * paced as recorded. `seq` and `cat` floods are timed and recorded, not gated. Every run
 * appends one line to `e2e/speed-results.log`.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { show } from "./helpers/app.js";
import { ROOT } from "./helpers/results.js";

const FIXTURE = join(ROOT, "e2e", "fixtures", "claude-turn.json");
const LOG = join(ROOT, "e2e", "speed-results.log");
const WEBGL = 1;
const DOM = 0.55; // the look the spike saw; the measured alphas may move it (criterion 26)
const FAST_RUNS = 5;
const FLOOD_RUNS = 3;
const MAX_RATIO = 2;
const MAX_GAP_MS = 100;
const BATCH_BYTES = 1_000_000;

type Result = {
  renderer: string;
  mode: string;
  bytes: number;
  ms: number;
  maxFrameGapMs: number;
  framesOver50: number;
};
type Run = { alpha: number; payload: "turn" | "seq" | "cat"; pace: "fast" | "paced" };

/** Starts a run in the page and polls for its result: a paced turn outlasts any script timeout. */
async function run(opts: Run): Promise<Result> {
  await browser.execute((o) => {
    const w = window as any;
    w.__speed = null;
    w.__oscillateBench
      .run(o)
      .then((r: unknown) => (w.__speed = r), (e: unknown) => (w.__speed = { error: String(e) }));
  }, opts);
  // WebDriver returns an unset value as null, never undefined.
  let result: any;
  await browser.waitUntil(
    async () => (result = await browser.execute(() => (window as any).__speed)) != null,
    { timeout: 15 * 60_000, interval: 1000, timeoutMsg: `bench: ${JSON.stringify(opts)} never finished` },
  );
  if (result.error) throw new Error(`bench: ${result.error}`);
  return result as Result;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const f0 = (n: number) => n.toFixed(0);

describe("speed gate", () => {
  // The hour-long timeout is `--mochaOpts.timeout` in `npm run e2e:speed`: WDIO's wrapper
  // ignores `this.timeout()`.
  it("DOM drains a recorded Claude turn within 2× of WebGL, with no stall", async () => {
    if (!existsSync(FIXTURE))
      throw new Error(`no ${FIXTURE}: record a turn and scrub it first (PLAN-ui-pass.md, the speed gate)`);
    const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));

    await show([]);
    // Load the turn in batches, so no single WebDriver call carries the whole of it.
    let batch: object[] = [];
    let size = 0;
    let reset = true;
    const send = async () => {
      const meta = { cols: fixture.cols, rows: fixture.rows, reset };
      await browser.execute((m, b) => (window as any).__oscillateBench.load(m, b), meta, batch);
      batch = [];
      size = 0;
      reset = false;
    };
    for (const c of fixture.chunks) {
      batch.push(c);
      size += c.b64.length;
      if (size >= BATCH_BYTES) await send();
    }
    if (batch.length) await send();

    const fast: Record<number, Result[]> = { [WEBGL]: [], [DOM]: [] };
    for (let i = 0; i < FAST_RUNS; i++)
      for (const alpha of [WEBGL, DOM]) fast[alpha].push(await run({ alpha, payload: "turn", pace: "fast" }));
    const paced: Record<number, Result> = {};
    for (const alpha of [WEBGL, DOM]) paced[alpha] = await run({ alpha, payload: "turn", pace: "paced" });
    const floods: Record<string, number> = {};
    for (const payload of ["seq", "cat"] as const)
      for (const alpha of [WEBGL, DOM]) {
        const times: number[] = [];
        for (let i = 0; i < FLOOD_RUNS; i++) times.push((await run({ alpha, payload, pace: "fast" })).ms);
        floods[`${payload}@${alpha}`] = median(times);
      }

    const renderers = [WEBGL, DOM].map((a) => fast[a][0].renderer);
    if (renderers[0] !== "webgl" || renderers[1] !== "dom")
      throw new Error(`bench: wrong renderers ${renderers.join("/")}; the alpha switch isn't working`);
    const turnMs = { webgl: median(fast[WEBGL].map((r) => r.ms)), dom: median(fast[DOM].map((r) => r.ms)) };
    const ratio = turnMs.dom / turnMs.webgl;
    const gap = { webgl: paced[WEBGL].maxFrameGapMs, dom: paced[DOM].maxFrameGapMs };

    const table = [
      `speed gate (${fast[WEBGL][0].mode} mode, ${fixture.cols}x${fixture.rows}, turn ${fast[WEBGL][0].bytes} bytes)`,
      `                     webgl       dom    dom/webgl`,
      `turn fast (median)  ${f0(turnMs.webgl).padStart(6)} ms ${f0(turnMs.dom).padStart(6)} ms  ${ratio.toFixed(2)}×  (gate ≤ ${MAX_RATIO}×)`,
      `turn paced max gap  ${f0(gap.webgl).padStart(6)} ms ${f0(gap.dom).padStart(6)} ms         (gate dom ≤ ${MAX_GAP_MS} ms)`,
      `turn paced >50ms    ${String(paced[WEBGL].framesOver50).padStart(6)}    ${String(paced[DOM].framesOver50).padStart(6)}`,
      `seq fast (median)   ${f0(floods[`seq@${WEBGL}`]).padStart(6)} ms ${f0(floods[`seq@${DOM}`]).padStart(6)} ms  ${(floods[`seq@${DOM}`] / floods[`seq@${WEBGL}`]).toFixed(2)}×  (recorded)`,
      `cat fast (median)   ${f0(floods[`cat@${WEBGL}`]).padStart(6)} ms ${f0(floods[`cat@${DOM}`]).padStart(6)} ms  ${(floods[`cat@${DOM}`] / floods[`cat@${WEBGL}`]).toFixed(2)}×  (recorded)`,
    ];
    console.log(`\n=== ${table.join("\n")}\n===`);

    const noisy = gap.webgl > MAX_GAP_MS;
    const pass = !noisy && ratio <= MAX_RATIO && gap.dom <= MAX_GAP_MS;
    appendFileSync(
      LOG,
      `${new Date().toISOString()} ${noisy ? "NOISY" : pass ? "PASS" : "FAIL"} mode=${fast[WEBGL][0].mode} ` +
        `turn=${f0(turnMs.webgl)}/${f0(turnMs.dom)}ms ratio=${ratio.toFixed(2)} gap=${f0(gap.webgl)}/${f0(gap.dom)}ms ` +
        `seq=${f0(floods[`seq@${WEBGL}`])}/${f0(floods[`seq@${DOM}`])}ms cat=${f0(floods[`cat@${WEBGL}`])}/${f0(floods[`cat@${DOM}`])}ms ` +
        `dom-alpha=${DOM}\n`,
    );
    if (noisy) throw new Error(`noisy run: WebGL itself stalled ${f0(gap.webgl)} ms; run it again`);
    if (ratio > MAX_RATIO) throw new Error(`DOM drained the turn ${ratio.toFixed(2)}× slower than WebGL (gate ${MAX_RATIO}×)`);
    if (gap.dom > MAX_GAP_MS) throw new Error(`DOM stalled a frame for ${f0(gap.dom)} ms (gate ${MAX_GAP_MS} ms)`);
  });
});
