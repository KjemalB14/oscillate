/**
 * The speed gate's page side (`PLAN-ui-pass.md`, criterion 23), in `npm run e2e` builds
 * only. `e2e/speed.check.ts` loads a recorded Claude turn here, then times it and two
 * floods into a fresh terminal at a given alpha, which picks the renderer
 * (`createTerminal`). Bytes go straight to `term.write`: panes run only `claude attach`,
 * so there's no shell to run `bench-flood` in.
 */
import { palettes, withAlpha } from "./palette";
import { createTerminal } from "./terminal";
import { currentMode } from "./theme";

export type Payload = "turn" | "seq" | "cat";
export type Pace = "fast" | "paced";
export type Result = {
  renderer: "webgl" | "dom";
  mode: string;
  bytes: number;
  ms: number;
  maxFrameGapMs: number;
  framesOver50: number;
};

type Chunk = { t: number; bytes: Uint8Array };
type Recording = { cols: number; rows: number; chunks: Chunk[] };

const turn: Recording = { cols: 0, rows: 0, chunks: [] };
const floods: Partial<Record<"seq" | "cat", Recording>> = {};

/** Floods arrive in PTY-sized chunks, as a real `cat` would. */
const FLOOD_CHUNK = 64 * 1024;
const FLOOD_SIZE = { cols: 120, rows: 40 };

function decode(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Text lines into PTY-sized chunks, all at t = 0. */
function chunked(lines: Iterable<string>): Chunk[] {
  const enc = new TextEncoder();
  const chunks: Chunk[] = [];
  let buf = "";
  for (const line of lines) {
    buf += line;
    if (buf.length >= FLOOD_CHUNK) {
      chunks.push({ t: 0, bytes: enc.encode(buf) });
      buf = "";
    }
  }
  if (buf) chunks.push({ t: 0, bytes: enc.encode(buf) });
  return chunks;
}

function* seqLines() {
  for (let i = 1; i <= 2_000_000; i++) yield `${i}\r\n`;
}

/** `bench-flood`'s 20MB `cat` fixture, line for line, with the PTY's `\n` → `\r\n`. */
function* catLines() {
  for (let i = 0, size = 0; size < 20_000_000; i++) {
    const hash = ((i * 2654435761) % 2 ** 32).toString(16).padStart(8, "0");
    const line = `\x1b[${31 + (i % 7)}m${String(i).padStart(8, "0")}\x1b[0m the quick brown fox jumps over the lazy dog ${hash}\n`;
    size += line.length;
    yield line.slice(0, -1) + "\r\n";
  }
}

function recording(payload: Payload): Recording {
  if (payload === "turn") return turn;
  return (floods[payload] ??= {
    ...FLOOD_SIZE,
    chunks: chunked(payload === "seq" ? seqLines() : catLines()),
  });
}

const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Appends a batch of the recorded turn; `reset` starts a new recording. */
function load(meta: { cols: number; rows: number; reset?: boolean }, batch: { t: number; b64: string }[]) {
  if (meta.reset) turn.chunks = [];
  turn.cols = meta.cols;
  turn.rows = meta.rows;
  for (const c of batch) turn.chunks.push({ t: c.t, bytes: decode(c.b64) });
  return turn.chunks.length;
}

/**
 * Writes one payload into a new terminal at `alpha`, on top of the window, and times it
 * until the last write is parsed and two frames have drawn. `fast` writes every chunk
 * at once; `paced` writes each at its recorded offset. Every frame gap is logged.
 */
async function run({ alpha, payload, pace }: { alpha: number; payload: Payload; pace: Pace }): Promise<Result> {
  const rec = recording(payload);
  if (!rec.chunks.length) throw new Error(`bench: no ${payload} loaded`);
  const mode = currentMode();
  const host = document.createElement("div");
  host.className = "terminal-host";
  Object.assign(host.style, {
    position: "fixed",
    inset: "0",
    zIndex: "9999",
    background: withAlpha(palettes[mode].terminal.background, alpha),
  });
  document.body.append(host);
  const { term, dispose } = createTerminal(host, { alpha });
  term.resize(rec.cols, rec.rows);  const canvases = [...host.querySelectorAll("canvas")];
  const renderer = canvases.some((c) => c.getContext("webgl2")) ? "webgl" : "dom";
  await nextFrame();

  let watching = true;
  let maxFrameGapMs = 0;
  let framesOver50 = 0;
  const watch = async () => {
    let last = await nextFrame();
    while (watching) {
      const now = await nextFrame();
      maxFrameGapMs = Math.max(maxFrameGapMs, now - last);
      if (now - last > 50) framesOver50++;
      last = now;
    }
  };
  const watched = watch();

  let parsed!: () => void;
  const allParsed = new Promise<void>((r) => (parsed = r));
  const start = performance.now();
  const lastChunk = rec.chunks.length - 1;
  for (const [i, c] of rec.chunks.entries()) {
    if (pace === "paced") await sleep(start + c.t - performance.now());
    term.write(c.bytes, i === lastChunk ? parsed : undefined);
  }
  await allParsed;
  await nextFrame();
  await nextFrame();
  const ms = performance.now() - start;

  watching = false;
  await watched;
  dispose();
  host.remove();
  const bytes = rec.chunks.reduce((n, c) => n + c.bytes.length, 0);
  return { renderer, mode, bytes, ms, maxFrameGapMs, framesOver50 };
}

declare global {
  interface Window {
    __oscillateBench?: { load: typeof load; run: typeof run };
  }
}

window.__oscillateBench = { load, run };
