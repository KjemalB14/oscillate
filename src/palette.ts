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

/** How much of the terminal's background color covers what's behind it. */
export const TERMINAL_ALPHA = 0.8;

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

/** `#rrggbb` → `rgb(r g b / a%)`. */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16} ${(n >> 8) & 255} ${n & 255} / ${Math.round(alpha * 100)}%)`;
}

const ANSI_KEYS = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow",
  "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
] as const;

/** xterm's theme for a mode: every color set, the background translucent. */
export function terminalTheme(mode: Mode): ITheme {
  const { terminal: t, chrome } = palettes[mode];
  const theme: ITheme = {
    background: withAlpha(t.background, TERMINAL_ALPHA),
    foreground: t.foreground,
    cursor: t.cursor,
    cursorAccent: t.background,
    selectionBackground: t.selection,
    scrollbarSliderBackground: chrome.hover,
    scrollbarSliderHoverBackground: chrome.selected,
    scrollbarSliderActiveBackground: chrome.selected,
  };
  ANSI_KEYS.forEach((key, i) => (theme[key] = t.ansi[i]));
  return theme;
}

/** `needsYou` → `needs-you`. */
export function cssName(role: string): string {
  return role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
