import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** What the sidebar shows for a session; mirrors `UiState` in `src-tauri/src/sessions.rs`. */
export type UiState =
  | "working"
  | "needs-you"
  | "done"
  | "failed"
  | "stopped"
  | "paused"
  | "terminal-tab"
  | "unknown";

/** Mirrors `Session` in `src-tauri/src/sessions.rs`. */
export interface Session {
  /** Stable across polls. */
  key: string;
  /** What `claude attach` takes; null for a terminal-tab session. */
  id: string | null;
  name: string | null;
  cwd: string;
  kind: string;
  state: UiState;
  rawState: string | null;
  waitingFor: string | null;
  startedAt: number;
  /** What rows sort by, newest first: the `startedAt` the app first saw for this `key`. */
  sortKey: number;
}

/**
 * The session list: null until Rust has a good poll, then every `sessions-changed`.
 * Subscribes before asking for the snapshot, so no change falls between the two; an
 * event that lands before the snapshot answers is newer, and wins.
 */
export function useSessions(): Session[] | null {
  const [sessions, setSessions] = useState<Session[] | null>(null);

  useEffect(() => {
    let disposed = false;
    let heard = false;
    const unlisten = listen<Session[]>("sessions-changed", (e) => {
      heard = true;
      if (!disposed) setSessions(e.payload);
    });
    unlisten
      .then(() => invoke<Session[] | null>("sessions_snapshot"))
      .then((snapshot) => {
        if (!disposed && !heard && snapshot) setSessions(snapshot);
      })
      .catch((e) => console.error("sessions:", e));
    return () => {
      disposed = true;
      void unlisten.then((f) => f());
    };
  }, []);

  return sessions;
}
