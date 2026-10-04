import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@xterm/xterm/css/xterm.css";
import { TERMINAL_ALPHA, terminalTheme } from "./palette";
import { currentMode, MONO_FONT, onModeChange } from "./theme";

/** Links open on Cmd+click, as in Ghostty and iTerm. */
function openOnCmdClick(event: MouseEvent, uri: string) {
  if (event.metaKey) void openUrl(uri);
}

/**
 * A terminal as every pane has it, opened in `host` and fitted to it. It follows macOS
 * between light and dark until `dispose`, which also disposes the terminal.
 */
export function createTerminal(host: HTMLElement): {
  term: Terminal;
  fit: FitAddon;
  dispose: () => void;
} {
  const term = new Terminal({
    allowProposedApi: true, // unicode-graphemes
    fontFamily: MONO_FONT,
    fontSize: 14,
    cursorBlink: true,
    scrollback: 10_000,
    macOptionIsMeta: true,
    macOptionClickForcesSelection: true,
    // Claude's TUI switches to the kitty keyboard protocol when the terminal offers it,
    // as Ghostty does. Without it a bare ESC is ambiguous and Esc-Esc doesn't clear.
    vtExtensions: { kittyKeyboard: true },
    linkHandler: { activate: openOnCmdClick }, // OSC 8
    // Only a translucent background (`TERMINAL_ALPHA`) needs it, and it costs dim text.
    allowTransparency: TERMINAL_ALPHA < 1,
    theme: terminalTheme(currentMode()),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  // Grapheme clusters (👍🏽, 👨‍👩‍👧) take one glyph, as in Ghostty; unicode11 split them.
  term.loadAddon(new UnicodeGraphemesAddon());
  term.loadAddon(new WebLinksAddon(openOnCmdClick));

  term.open(host);
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose()); // falls back to the DOM renderer
    term.loadAddon(webgl);
  } catch (e) {
    console.warn("WebGL renderer unavailable, using DOM:", e);
  }
  fit.fit();
  const unfollow = onModeChange((mode) => (term.options.theme = terminalTheme(mode)));
  return {
    term,
    fit,
    dispose: () => {
      unfollow();
      term.dispose();
    },
  };
}
