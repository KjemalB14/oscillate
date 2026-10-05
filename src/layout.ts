import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export const MIN_WIDTH = 208;
export const MAX_WIDTH = 400;
export const DEFAULT_WIDTH = 256;

interface Stored {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
}

export interface Layout {
  /** The sidebar's width when open, within `MIN_WIDTH`–`MAX_WIDTH`. */
  width: number;
  collapsed: boolean;
  /** False until Rust answers, so the first paint never animates from the default. */
  loaded: boolean;
  /** While dragging: moves the edge without saving. `commit` sets and saves the last one. */
  drag: (width: number) => void;
  commit: (width: number) => void;
  /** A double-click on the edge. */
  reset: () => void;
  /** ⌃⌘S and the toggle button. */
  toggle: () => void;
}

const clamp = (w: number) => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w)));

/** The sidebar's width and collapsed state, kept in the app's `layout.json` (`layout.rs`). */
export function useLayout(): Layout {
  const [now, setNow] = useState<Stored>({ sidebarWidth: DEFAULT_WIDTH, sidebarCollapsed: false });
  const [loaded, setLoaded] = useState(false);
  const latest = useRef(now);
  latest.current = now;

  useEffect(() => {
    invoke<Stored>("layout_get")
      .then(setNow)
      .catch((e) => console.error("layout:", e))
      .finally(() => setLoaded(true));
  }, []);

  const save = (next: Stored) => {
    setNow(next);
    invoke<Stored>("layout_set", { next }).catch((e) => console.error("layout:", e));
  };
  return {
    width: now.sidebarWidth,
    collapsed: now.sidebarCollapsed,
    loaded,
    drag: (width) => setNow((n) => ({ ...n, sidebarWidth: clamp(width) })),
    commit: (width) => save({ ...latest.current, sidebarWidth: clamp(width) }),
    reset: () => save({ ...latest.current, sidebarWidth: DEFAULT_WIDTH }),
    toggle: () => save({ ...latest.current, sidebarCollapsed: !latest.current.sidebarCollapsed }),
  };
}
