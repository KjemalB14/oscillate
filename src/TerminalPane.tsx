import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@xterm/xterm/css/xterm.css";
import { initialSession, spawnPty, type Pty } from "./pty";

/** Ack parsed output in batches; the Rust reader pauses at 1MB unacked. */
const ACK_BATCH = 64 * 1024;

/** Links open on Cmd+click, as in Ghostty and iTerm. */
function openOnCmdClick(event: MouseEvent, uri: string) {
  if (event.metaKey) void openUrl(uri);
}

export function TerminalPane() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = new Terminal({
      allowProposedApi: true, // unicode-graphemes
      fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
      fontSize: 14,
      cursorBlink: true,
      scrollback: 10_000,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      // Claude's TUI switches to the kitty keyboard protocol when the terminal offers it,
      // as Ghostty does. Without it a bare ESC is ambiguous and Esc-Esc doesn't clear.
      vtExtensions: { kittyKeyboard: true },
      linkHandler: { activate: openOnCmdClick }, // OSC 8
      theme: { background: "#1e1e1e" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    // Grapheme clusters (👍🏽, 👨‍👩‍👧) take one glyph, as in Ghostty; unicode11 split them.
    term.loadAddon(new UnicodeGraphemesAddon());
    term.loadAddon(new WebLinksAddon(openOnCmdClick));

    term.open(host.current!);
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose()); // falls back to the DOM renderer
      term.loadAddon(webgl);
    } catch (e) {
      console.warn("WebGL renderer unavailable, using DOM:", e);
    }
    fit.fit();
    term.focus();

    let pty: Pty | undefined;
    let disposed = false;
    let unacked = 0;
    let ackTimer: number | undefined;
    const flushAck = () => {
      clearTimeout(ackTimer);
      ackTimer = undefined;
      pty?.ack(unacked);
      unacked = 0;
    };
    const encoder = new TextEncoder();

    const start = async () => {
      const session = await initialSession();
      const what = session ? `claude attach ${session}` : "shell";
      const p = await spawnPty(
        session,
        term.cols,
        term.rows,
        (bytes) =>
          term.write(bytes, () => {
            unacked += bytes.length;
            // Small outputs never fill a batch, so they are flushed once output pauses.
            if (unacked >= ACK_BATCH) flushAck();
            else ackTimer ??= setTimeout(flushAck, 50);
          }),
        (code) => {
          const how = code === null || code === 0 ? "" : ` with code ${code}`;
          // Nothing reads input any more, so the cursor is hidden too.
          const note = session ? `detached from ${session}` : "process exited";
          term.write(`\r\n[${note}${how}]\r\n\x1b[?25l`);
        },
      ).catch((e) => {
        term.write(`\r\n[failed to start ${what}: ${e}]\r\n`);
      });
      if (!p) return;
      // A PTY that arrives after unmount is killed.
      if (disposed) return p.kill();
      pty = p;
      pty.resize(term.cols, term.rows);
    };
    // StrictMode mounts, unmounts and remounts synchronously in dev. Deferring the spawn
    // means only the surviving mount starts one, so a session never gets two attaches.
    const startTimer = setTimeout(start, 0);

    const input = term.onData((d) => pty?.write(encoder.encode(d)));
    // Mouse reports in X10 mode arrive as a binary string, one byte per char.
    const binary = term.onBinary((d) =>
      pty?.write(Uint8Array.from(d, (c) => c.charCodeAt(0) & 0xff)),
    );
    const resize = term.onResize(({ cols, rows }) => pty?.resize(cols, rows));
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(host.current!);

    return () => {
      disposed = true;
      clearTimeout(startTimer);
      observer.disconnect();
      clearTimeout(ackTimer);
      input.dispose();
      binary.dispose();
      resize.dispose();
      pty?.kill();
      term.dispose();
    };
  }, []);

  return <div ref={host} className="terminal-pane" />;
}
