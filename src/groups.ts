import type { Session } from "./sessions";

export interface RepoGroup {
  /** The session's `cwd`; "" for sessions that report none. */
  key: string;
  /** The `cwd` basename, with parent segments added until no two groups share it. */
  label: string;
  /** Newest first by `sortKey`, so a respawned or renamed session keeps its place. */
  sessions: Session[];
}

export const NO_FOLDER = "No folder";

const segments = (cwd: string) => cwd.split("/").filter(Boolean);

/** The last `depth` segments of `cwd`, or the whole path when it has fewer. */
function tail(cwd: string, depth: number): string {
  const parts = segments(cwd);
  return parts.slice(Math.max(0, parts.length - depth)).join("/") || cwd || NO_FOLDER;
}

/**
 * Groups sessions by `cwd`, one group per directory, sorted by label. Two repos with the
 * same basename (`~/code/beta`, `~/other/beta`) are labelled `code/beta` and `other/beta`;
 * a group only gets as many parent segments as it needs to be told apart.
 */
export function groupSessions(sessions: Session[]): RepoGroup[] {
  const byCwd = new Map<string, Session[]>();
  for (const s of sessions) {
    const list = byCwd.get(s.cwd);
    if (list) list.push(s);
    else byCwd.set(s.cwd, [s]);
  }

  const depth = new Map([...byCwd.keys()].map((cwd) => [cwd, 1]));
  for (;;) {
    const holders = new Map<string, string[]>();
    for (const [cwd, d] of depth) {
      const label = tail(cwd, d);
      holders.set(label, [...(holders.get(label) ?? []), cwd]);
    }
    let deepened = false;
    for (const cwds of holders.values()) {
      if (cwds.length < 2) continue;
      for (const cwd of cwds) {
        if (depth.get(cwd)! < segments(cwd).length) {
          depth.set(cwd, depth.get(cwd)! + 1);
          deepened = true;
        }
      }
    }
    // Stops when every label is unique, or when colliding paths have no parents left.
    if (!deepened) break;
  }

  return [...byCwd]
    .map(([cwd, list]) => ({
      key: cwd,
      label: tail(cwd, depth.get(cwd)!),
      sessions: [...list].sort((a, b) => b.sortKey - a.sortKey || a.key.localeCompare(b.key)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}
