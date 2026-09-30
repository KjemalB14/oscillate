import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { UiState } from "./sessions";

/** Mirrors `End` in `src-tauri/src/endsession.rs`. */
export type End = "stop" | "remove";

/** The states Stop is offered in: a session that is still live. */
export const STOPPABLE: ReadonlySet<UiState> = new Set<UiState>(["working", "needs-you", "paused"]);

/**
 * What a row's Stop or Remove is doing: Remove's one-line confirm, the command running,
 * or how it failed, verbatim (an `rm` refusal).
 */
export type RowAction =
  | { kind: "confirm" }
  | { kind: "running"; end: End }
  | { kind: "failed"; end: End; message: string };

export interface RowActions {
  /** By session id; a row with no entry is idle. */
  actions: ReadonlyMap<string, RowAction>;
  /** Runs at once: attach undoes it. */
  stop: (id: string) => void;
  /** Asks first, under the row. */
  askRemove: (id: string) => void;
  confirmRemove: (id: string) => void;
  /** Cancels a confirm, or clears a failure. */
  dismiss: (id: string) => void;
}

/**
 * Stop and Remove from a row's menu. Rust closes the row's attach and waits for it to be
 * reaped before it runs `claude stop` or `claude rm`; a failure is kept to show verbatim,
 * and nothing is retried.
 */
export function useRowActions(): RowActions {
  const [actions, setActions] = useState<ReadonlyMap<string, RowAction>>(new Map());
  const set = (id: string, action: RowAction | null) =>
    setActions((prev) => {
      const next = new Map(prev);
      if (action) next.set(id, action);
      else next.delete(id);
      return next;
    });
  const run = (id: string, end: End) => {
    set(id, { kind: "running", end });
    invoke("end_session", { id, end })
      .then(() => set(id, null))
      .catch((e) => set(id, { kind: "failed", end, message: String(e) }));
  };
  return {
    actions,
    stop: (id) => run(id, "stop"),
    askRemove: (id) => set(id, { kind: "confirm" }),
    confirmRemove: (id) => run(id, "remove"),
    dismiss: (id) => set(id, null),
  };
}
