import { Channel, invoke } from "@tauri-apps/api/core";

/** Frontend handle for a PTY owned by Rust (src-tauri/src/pty.rs). */
export interface Pty {
  id: number;
  write(data: Uint8Array): void;
  resize(cols: number, rows: number): void;
  ack(bytes: number): void;
  kill(): void;
}

/** The trust pane's PTY. It has no `kill`: the app never ends the trust `claude`. */
export type TrustPty = Omit<Pty, "kill">;

/** Mirrors `TrustInfo` in `src-tauri/src/pty.rs`: a start waiting on the trust prompt. */
export interface TrustInfo {
  cwd: string;
  label: string;
  prompt: string;
  /** null is Default. */
  mode: string | null;
}

function channels(onData: (bytes: Uint8Array) => void, onExit: (code: number | null) => void) {
  const data = new Channel<ArrayBuffer>();
  data.onmessage = (buf) => onData(new Uint8Array(buf));
  const exit = new Channel<number | null>();
  exit.onmessage = onExit;
  return { onData: data, onExit: exit };
}

function handle(id: number): Pty {
  const log = (e: unknown) => console.error(`pty ${id}:`, e);
  return {
    id,
    write: (bytes) => void invoke("pty_write", { id, data: Array.from(bytes) }).catch(log),
    resize: (c, r) => void invoke("pty_resize", { id, cols: c, rows: r }).catch(log),
    ack: (bytes) => void invoke("pty_ack", { id, bytes }).catch(log),
    kill: () => void invoke("pty_kill", { id }).catch(log),
  };
}

/**
 * Spawns `claude attach <session>` in the session's own `cwd`. Rejects with a message
 * when that directory is gone, or the session already has a PTY (invariant 3).
 */
export async function spawnPty(
  session: string,
  cols: number,
  rows: number,
  onData: (bytes: Uint8Array) => void,
  onExit: (code: number | null) => void,
): Promise<Pty> {
  const id = await invoke<number>("pty_spawn", { session, cols, rows, ...channels(onData, onExit) });
  return handle(id);
}

/**
 * Opens the trust pane's PTY: interactive `claude` in `info.cwd`. If it is already
 * running (after a reload), Rust rebinds it to these callbacks instead of spawning.
 */
export async function openTrust(
  info: TrustInfo,
  cols: number,
  rows: number,
  onData: (bytes: Uint8Array) => void,
  onExit: (code: number | null) => void,
): Promise<TrustPty> {
  const id = await invoke<number>("trust_open", { info, cols, rows, ...channels(onData, onExit) });
  const { kill: _never, ...pty } = handle(id);
  return pty;
}
