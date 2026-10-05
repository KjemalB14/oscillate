import { cssName, palettes, terminalTheme, type Mode } from "./palette";

/** The chrome's typefaces, both bundled (`src/fonts.css`). */
export const UI_FONT = '"Geist Variable", -apple-system, BlinkMacSystemFont, sans-serif';
export const MONO_FONT = '"JetBrains Mono Bundled", ui-monospace, Menlo, monospace';

const dark = window.matchMedia("(prefers-color-scheme: dark)");

/** The appearance macOS is in right now. */
export function currentMode(): Mode {
  return dark.matches ? "dark" : "light";
}

/** Calls `f` with the new mode whenever macOS switches; returns the unsubscribe. */
export function onModeChange(f: (mode: Mode) => void): () => void {
  const listener = () => f(currentMode());
  dark.addEventListener("change", listener);
  return () => dark.removeEventListener("change", listener);
}

function applyChrome(mode: Mode) {
  const root = document.documentElement;
  for (const [role, color] of Object.entries(palettes[mode].chrome)) {
    root.style.setProperty(`--${cssName(role)}`, color);
  }
  // The terminal's own background, for the host's padding around the cell grid.
  root.style.setProperty("--terminal-bg", terminalTheme(mode).background!);
  root.style.setProperty("--font-ui", UI_FONT);
  root.style.setProperty("--font-mono", MONO_FONT);
  root.dataset.mode = mode;
}

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/**
 * `data-motion="reduce"` on the root while macOS reduces motion. Every animation and
 * transition in `App.css` keys off it, not off the media query, so there's one switch.
 */
function applyMotion() {
  if (reduceMotion.matches) document.documentElement.dataset.motion = "reduce";
  else delete document.documentElement.dataset.motion;
}

/**
 * Paints the chrome for the current mode and follows every switch, without a reload.
 * Terminals follow on their own (`createTerminal`). Follows reduced motion the same way.
 */
export function startTheme() {
  applyChrome(currentMode());
  onModeChange(applyChrome);
  applyMotion();
  reduceMotion.addEventListener("change", applyMotion);
}

/** Resolves once both bundled faces are ready, so xterm measures the right cell. */
export function fontsReady(): Promise<unknown> {
  return Promise.all([
    document.fonts.load('14px "JetBrains Mono Bundled"'),
    document.fonts.load('bold 14px "JetBrains Mono Bundled"'),
    document.fonts.load('13px "Geist Variable"'),
  ]).catch((e) => console.warn("fonts:", e));
}
