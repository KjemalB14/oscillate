import { useEffect, useRef } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { createTerminal } from "./terminal";
import { openTrust, type TrustInfo, type TrustPty } from "./pty";

/** Ack parsed output in batches; the Rust reader pauses at 1MB unacked. */
const ACK_BATCH = 64 * 1024;

/** The trust pane's label, and its accessible name. */
export const TRUST_LABEL = "Accept trust, then /exit";

interface Props {
  info: TrustInfo;
  visible: boolean;
  /** Changes whenever the pane is asked for; it then takes the keyboard. */
  focusRequest: number;
  /** The trust `claude` has exited, for whatever reason. */
  onExit: () => void;
  /** It couldn't be started at all. */
  onFailed: (message: string) => void;
}

/**
 * Interactive `claude` in a repo that isn't trusted yet, so its trust prompt can be
 * answered. It sits outside the pane pool, and nothing here ever ends it: it has no close
 * control, and unmounting leaves it running (Rust refuses to signal it anyway). When it
 * exits, the app retries the start once (PLAN-new-sessions.md, *Trust*).
 */
export function TrustPane({ info, visible, focusRequest, onExit, onFailed }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal>(null);
  const fit = useRef<FitAddon>(null);
  const visibleNow = useRef(visible);
  visibleNow.current = visible;

  useEffect(() => {
    const { term: t, fit: f, dispose } = createTerminal(host.current!);
    term.current = t;
    fit.current = f;
    let disposed = false;
    let pty: TrustPty | undefined;
    let unacked = 0;
    let ackTimer: number | undefined;
    const flushAck = () => {
      clearTimeout(ackTimer);
      ackTimer = undefined;
      if (!pty) return;
      pty.ack(unacked);
      unacked = 0;
    };

    const encoder = new TextEncoder();
    const input = t.onData((d) => pty?.write(encoder.encode(d)));
    const binary = t.onBinary((d) => pty?.write(Uint8Array.from(d, (c) => c.charCodeAt(0) & 0xff)));
    const resize = t.onResize(({ cols, rows }) => pty?.resize(cols, rows));
    const observer = new ResizeObserver(() => f.fit());
    observer.observe(host.current!);

    // Deferred, so StrictMode's throwaway mount opens nothing.
    const startTimer = setTimeout(() => {
      openTrust(
        info,
        t.cols,
        t.rows,
        (bytes) =>
          t.write(bytes, () => {
            unacked += bytes.length;
            if (unacked >= ACK_BATCH) flushAck();
            else ackTimer ??= setTimeout(flushAck, 50);
          }),
        () => {
          pty = undefined;
          if (!disposed) onExit();
        },
      )
        .then((p) => {
          if (disposed) return;
          pty = p;
          flushAck();
          if (visibleNow.current) t.focus();
        })
        .catch((e) => !disposed && onFailed(String(e)));
    }, 0);

    return () => {
      // Never a kill: the trust `claude` runs on until it's answered.
      disposed = true;
      clearTimeout(startTimer);
      clearTimeout(ackTimer);
      observer.disconnect();
      input.dispose();
      binary.dispose();
      resize.dispose();
      dispose();
      term.current = null;
      fit.current = null;
    };
    // The pane is keyed by its cwd; `info` is fixed for its life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!visible) return;
    fit.current?.fit();
    term.current?.focus();
  }, [visible, focusRequest]);

  return (
    <section
      className={`terminal-pane trust-pane${visible ? "" : " hidden"}`}
      aria-label={TRUST_LABEL}
      aria-hidden={!visible || undefined}
    >
      <header className="trust-bar" title={info.cwd}>
        <strong>{TRUST_LABEL}</strong>
        <span className="trust-where">{info.label}</span>
      </header>
      <div ref={host} className="terminal-host" />
    </section>
  );
}
