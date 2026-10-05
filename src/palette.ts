import type { ITheme } from "@xterm/xterm";

/**
 * The app's colors, by role, for each appearance (PLAN-ui-pass.md, slice 1). Nothing
 * outside this file names a color; a later themes tab swaps whole variants here.
 *
 * Pure data: no DOM, so `.claude/scripts/check-theme` can import it and measure it.
 */

export type Mode = "light" | "dark";

/** The chrome's roles; each becomes a CSS variable (`needsYou` → `--needs-you`). */
export interface Chrome {
  /** The window under everything. Opaque until the glass (slice 2) replaces it. */
  window: string;
  /** The sidebar and the pane's bars: a translucent tint over the window. */
  sidebar: string;
  /** Inputs and anything that sits flush with the terminal. */
  ground: string;
  /** Floats: menus, the new-session box, notices. */
  raised: string;
  hover: string;
  selected: string;
  hairline: string;
  text: string;
  muted: string;
  /** Decoration only; never carries text that has to be read. */
  faint: string;
  focus: string;
  /** Text on a `focus` fill. */
  onFocus: string;
  working: string;
  needsYou: string;
  done: string;
  failed: string;
  stopped: string;
}

/** The terminal's colors, all opaque; `terminalTheme` adds the background's alpha. */
export interface TerminalColors {
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
  ansi: readonly [
    black: string,
    red: string,
    green: string,
    yellow: string,
    blue: string,
    magenta: string,
    cyan: string,
    white: string,
    brightBlack: string,
    brightRed: string,
    brightGreen: string,
    brightYellow: string,
    brightBlue: string,
    brightMagenta: string,
    brightCyan: string,
    brightWhite: string,
  ];
}

export interface Palette {
  chrome: Chrome;
  terminal: TerminalColors;
}

/**
 * How much of the terminal's background color covers what's behind it. 1 for now: under
 * `allowTransparency`, xterm's WebGL renderer draws dim text at a fraction of its alpha,
 * and Claude's status line all but vanishes in light mode (NOTES.md, slice 1's hand
 * items). Slice 2 brings the translucency back only with dim text that reads.
 */
export const TERMINAL_ALPHA = 1;

export const palettes: Record<Mode, Palette> = {
  dark: {
    chrome: {
      window: "#0b0b0c",
      sidebar: "rgb(17 17 19 / 90%)",
      ground: "#0e0e10",
      raised: "rgb(28 28 31 / 94%)",
      hover: "rgb(255 255 255 / 6%)",
      selected: "rgb(255 255 255 / 10%)",
      hairline: "rgb(255 255 255 / 9%)",
      text: "#ececee",
      muted: "#9d9da6",
      faint: "#5a5a62",
      focus: "#8b93ff",
      onFocus: "#0b0b0c",
      working: "#7aa7ff",
      needsYou: "#f2b84b",
      done: "#5fcf8a",
      failed: "#ff7b7b",
      stopped: "#85858e",
    },
    terminal: {
      background: "#0e0e10",
      foreground: "#e6e6e9",
      cursor: "#ececee",
      selection: "rgb(139 147 255 / 30%)",
      ansi: [
        "#2a2a2f", "#ff7b7b", "#7fd38f", "#e8c36a", "#7aa7ff", "#c79bff", "#6fd0d6", "#c9c9cf",
        "#6e6e78", "#ff9a9a", "#9be3a8", "#f2d58a", "#9cc0ff", "#d9b6ff", "#93e0e4", "#f4f4f6",
      ],
    },
  },
  light: {
    chrome: {
      window: "#f6f6f7",
      sidebar: "rgb(238 238 241 / 94%)",
      ground: "#fbfbfc",
      raised: "rgb(255 255 255 / 95%)",
      hover: "rgb(0 0 0 / 5%)",
      selected: "rgb(0 0 0 / 8%)",
      hairline: "rgb(0 0 0 / 10%)",
      text: "#1b1b1f",
      muted: "#5f5f68",
      faint: "#a8a8b0",
      focus: "#4f57e0",
      onFocus: "#ffffff",
      working: "#2f6fe0",
      needsYou: "#7a4600",
      done: "#1d7f45",
      failed: "#9e1c1c",
      stopped: "#74747d",
    },
    terminal: {
      background: "#fbfbfc",
      foreground: "#1b1b1f",
      cursor: "#1b1b1f",
      selection: "rgb(79 87 224 / 22%)",
      ansi: [
        "#1b1b1f", "#c62f2f", "#1d7f45", "#8f6400", "#2a5fd0", "#8a3fc9", "#0f7c86", "#8e8e96",
        "#5c5c64", "#d84444", "#23924f", "#a37200", "#3a6fe0", "#9b4fd8", "#128c97", "#c4c4cc",
      ],
    },
  },
};

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, "0");

/** `#rrggbb` → `#rrggbbaa`. */
export function withAlpha(hex: string, alpha: number): string {
  return `${hex}${hex2(alpha * 255)}`;
}

/**
 * A palette color in a form xterm parses: `#rrggbb`, or `#rrggbbaa` for our
 * `rgb(r g b / a%)`. xterm reads only hex and comma `rgba()`; anything else goes through
 * a canvas that rejects translucency, and the theme silently keeps xterm's default
 * (an opaque black background, NOTES.md, slice 1's hand items).
 */
export function xtermColor(color: string): string {
  const m = /^rgb\((\d+) (\d+) (\d+) \/ (\d+(?:\.\d+)?)%\)$/.exec(color);
  if (!m) return color;
  return `#${hex2(+m[1])}${hex2(+m[2])}${hex2(+m[3])}${hex2((+m[4] / 100) * 255)}`;
}

const ANSI_KEYS = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow",
  "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
] as const;

/** xterm's theme for a mode: every color set, the background at `alpha`. */
export function terminalTheme(mode: Mode, alpha = TERMINAL_ALPHA): ITheme {
  const { terminal: t, chrome } = palettes[mode];
  const theme: ITheme = {
    background: withAlpha(t.background, alpha),
    foreground: t.foreground,
    cursor: t.cursor,
    cursorAccent: t.background,
    selectionBackground: xtermColor(t.selection),
    scrollbarSliderBackground: xtermColor(chrome.hover),
    scrollbarSliderHoverBackground: xtermColor(chrome.selected),
    scrollbarSliderActiveBackground: xtermColor(chrome.selected),
  };
  ANSI_KEYS.forEach((key, i) => (theme[key] = t.ansi[i]));
  return theme;
}

/** `needsYou` → `needs-you`. */
export function cssName(role: string): string {
  return role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
