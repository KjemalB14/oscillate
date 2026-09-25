import { Channel, invoke } from "@tauri-apps/api/core";

/** Frontend handle for a PTY owned by Rust (src-tauri/src/pty.rs). */
export interface Pty {
  id: number;
  write(data: Uint8Array): void;
  resize(cols: number, rows: number): void;
  ack(bytes: number): void;
  kill(): void;
}

export async function spawnShell(
  cols: number,
  rows: number,
  onData: (bytes: Uint8Array) => void,
  onExit: (code: number | null) => void,
): Promise<Pty> {
  const data = new Channel<ArrayBuffer>();
  data.onmessage = (buf) => onData(new Uint8Array(buf));
  const exit = new Channel<number | null>();
  exit.onmessage = onExit;

  const id = await invoke<number>("pty_spawn", { cols, rows, onData: data, onExit: exit });
  const log = (e: unknown) => console.error(`pty ${id}:`, e);
  return {
    id,
    write: (bytes) => void invoke("pty_write", { id, data: Array.from(bytes) }).catch(log),
    resize: (c, r) => void invoke("pty_resize", { id, cols: c, rows: r }).catch(log),
    ack: (bytes) => void invoke("pty_ack", { id, bytes }).catch(log),
    kill: () => void invoke("pty_kill", { id }).catch(log),
  };
}
