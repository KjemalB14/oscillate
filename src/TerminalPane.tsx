import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@xterm/xterm/css/xterm.css";
import { spawnPty, type Pty } from "./pty";

/** Ack parsed output in batches; the Rust reader pauses at 1MB unacked. */
const ACK_BATCH = 64 * 1024;

/**
 * Written when the PTY exits: turns off every input mode the attached Claude may have
 * left on (mouse and focus reports, bracketed paste, application keys, the kitty
 * keyboard flags) and hides the cursor. A dead pane then sends nothing, and the click
 * that reattaches can't leak a stale mouse report into the new attach.
 */
const RESET_INPUT_MODES =
  "\x1b[?9l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1005l\x1b[?1006l\x1b[?1015l\x1b[?1016l" +
  "\x1b[?1004l\x1b[?2004l\x1b[?1l\x1b>\x1b[=0;1u\x1b[?25l";

export type PaneStatus = "attaching" | "live" | "detached" | "failed";

/** Links open on Cmd+click, as in Ghostty and iTerm. */
function openOnCmdClick(event: MouseEvent, uri: string) {
  if (event.metaKey) void openUrl(uri);
}

interface Props {
  /** The session id `claude attach` takes. */
  session: string;
  label: string;
  visible: boolean;
  /** Bumped by the parent to reattach after a detach or a failure. */
  attempt: number;
  onStatus: (session: string, status: PaneStatus) => void;
  onReattach: (session: string) => void;
}

/** One session's terminal. It stays mounted while hidden, so switching never reattaches. */
export function TerminalPane({ session, label, visible, attempt, onStatus, onReattach }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal>(null);
  const fit = useRef<FitAddon>(null);
  const pty = useRef<Pty>(null);
  /** Input typed while attaching, sent once the PTY is live; `null` when nothing is. */
  const pending = useRef<Uint8Array[] | null>(null);
  const visibleNow = useRef(visible);
  visibleNow.current = visible;
  const [ended, setEnded] = useState<string | null>(null);

  // The terminal: one per pane, for the pane's whole life.
  useEffect(() => {
    const t = new Terminal({
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
    const f = new FitAddon();
    t.loadAddon(f);
    // Grapheme clusters (👍🏽, 👨‍👩‍👧) take one glyph, as in Ghostty; unicode11 split them.
    t.loadAddon(new UnicodeGraphemesAddon());
    t.loadAddon(new WebLinksAddon(openOnCmdClick));

    t.open(host.current!);
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose()); // falls back to the DOM renderer
      t.loadAddon(webgl);
    } catch (e) {
      console.warn("WebGL renderer unavailable, using DOM:", e);
    }
    f.fit();
    term.current = t;
    fit.current = f;

    // Only a live PTY is written to; `pty` is cleared the moment it exits. What is typed
    // while attaching is held for it, so keys right after a click aren't lost.
    const send = (bytes: Uint8Array) => {
      if (pty.current) pty.current.write(bytes);
      else pending.current?.push(bytes);
    };
    const encoder = new TextEncoder();
    const input = t.onData((d) => send(encoder.encode(d)));
    // Mouse reports in X10 mode arrive as a binary string, one byte per char.
    const binary = t.onBinary((d) => send(Uint8Array.from(d, (c) => c.charCodeAt(0) & 0xff)));
    const resize = t.onResize(({ cols, rows }) => pty.current?.resize(cols, rows));
    const observer = new ResizeObserver(() => f.fit());
    observer.observe(host.current!);

    return () => {
      observer.disconnect();
      input.dispose();
      binary.dispose();
      resize.dispose();
      t.dispose();
      term.current = null;
      fit.current = null;
    };
  }, []);

  // The attach: once on mount, and again for each reattach.
  useEffect(() => {
    const t = term.current!;
    let disposed = false;
    let exited = false;
    let mine: Pty | undefined;
    let unacked = 0;
    let ackTimer: number | undefined;
    const flushAck = () => {
      clearTimeout(ackTimer);
      ackTimer = undefined;
      // Output can arrive before the PTY's id does; it is acked once the id is known.
      if (!mine) return;
      mine.ack(unacked);
      unacked = 0;
    };

    const start = async () => {
      if (attempt > 0) t.reset();
      setEnded(null);
      pending.current = [];
      onStatus(session, "attaching");
      const p = await spawnPty(
        session,
        t.cols,
        t.rows,
        (bytes) =>
          t.write(bytes, () => {
            unacked += bytes.length;
            // Small outputs never fill a batch, so they are flushed once output pauses.
            if (unacked >= ACK_BATCH) flushAck();
            else ackTimer ??= setTimeout(flushAck, 50);
          }),
        () => {
          exited = true;
          pending.current = null;
          if (pty.current === mine) pty.current = null;
          if (disposed) return;
          t.write(RESET_INPUT_MODES);
          setEnded("Detached — click to reattach");
          onStatus(session, "detached");
        },
      ).catch((e) => {
        pending.current = null;
        if (disposed) return;
        setEnded(`Couldn't attach: ${e} — click to retry`);
        onStatus(session, "failed");
      });
      if (!p) return;
      // A PTY that arrives after unmount is killed; one that already exited is left be.
      if (disposed) return p.kill();
      if (exited) return;
      mine = p;
      pty.current = p;
      p.resize(t.cols, t.rows);
      flushAck();
      for (const bytes of pending.current ?? []) p.write(bytes);
      pending.current = null;
      onStatus(session, "live");
      // The reattach button that was clicked is gone; the keyboard goes back to the pane.
      if (visibleNow.current) t.focus();
    };
    // StrictMode mounts, unmounts and remounts synchronously in dev. Deferring the spawn
    // means only the surviving mount starts one, so a session never gets two attaches.
    const startTimer = setTimeout(start, 0);

    return () => {
      disposed = true;
      pending.current = null;
      clearTimeout(startTimer);
      clearTimeout(ackTimer);
      if (pty.current === mine) pty.current = null;
      mine?.kill();
    };
    // `session` is fixed for a pane's life (it's the pane's key); only `attempt` reattaches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  useEffect(() => {
    if (!visible) return;
    fit.current?.fit();
    term.current?.focus();
  }, [visible]);

  return (
    <section
      className={`terminal-pane${visible ? "" : " hidden"}`}
      aria-label={`${label} terminal`}
      aria-hidden={!visible || undefined}
    >
      <div ref={host} className="terminal-host" />
      {ended && (
        <button className="pane-status" onClick={() => onReattach(session)}>
          {ended}
        </button>
      )}
    </section>
  );
}
