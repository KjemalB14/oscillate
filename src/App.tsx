import { useEffect, useRef, useState } from "react";
import "./App.css";
import type { RepoGroup } from "./groups";
import { NewSessionBox } from "./NewSessionBox";
import { useAddedRepos } from "./repos";
import { Sidebar } from "./Sidebar";
import { TerminalPane, type PaneStatus } from "./TerminalPane";
import { useSessions } from "./sessions";

/**
 * Live panes at most. Opening one more closes the least recently viewed, never the
 * visible one; reopening it costs one recap. Held to a measured budget
 * (NOTES.md, *Chapter 2 closed*).
 */
export const PANE_CAP = 6;

export default function App() {
  const sessions = useSessions();
  const repos = useAddedRepos();
  // The group whose "+" prompt box is open; one box at a time.
  const [newIn, setNewIn] = useState<RepoGroup | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Pane ids in the order they were opened, so a pane's DOM never moves.
  const [open, setOpen] = useState<string[]>([]);
  const [attempts, setAttempts] = useState<Record<string, number>>({});
  const viewedAt = useRef(new Map<string, number>());
  const status = useRef(new Map<string, PaneStatus>());

  const reattach = (id: string) => setAttempts((a) => ({ ...a, [id]: (a[id] ?? 0) + 1 }));

  const select = (id: string) => {
    viewedAt.current.set(id, performance.now());
    setSelected(id);
    if (open.includes(id)) {
      const s = status.current.get(id);
      if (s === "detached" || s === "failed") reattach(id);
      return;
    }
    setOpen((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      while (next.length > PANE_CAP) {
        const seen = (p: string) => viewedAt.current.get(p) ?? 0;
        const victim = next.filter((p) => p !== id).reduce((a, b) => (seen(b) < seen(a) ? b : a));
        next.splice(next.indexOf(victim), 1);
      }
      return next;
    });
  };

  // A session that is no longer listed loses its pane (Rust has already closed its PTY).
  useEffect(() => {
    if (!sessions) return;
    const listed = new Set(sessions.map((s) => s.id));
    setOpen((prev) => (prev.every((id) => listed.has(id)) ? prev : prev.filter((id) => listed.has(id))));
    setSelected((id) => (id && !listed.has(id) ? null : id));
  }, [sessions]);

  const byId = new Map((sessions ?? []).map((s) => [s.id, s]));
  return (
    <div className="app">
      <Sidebar
        sessions={sessions}
        selected={selected}
        onSelect={select}
        added={repos.list}
        onAddRepo={repos.add}
        onRemoveRepo={repos.remove}
        onNewSession={setNewIn}
      />
      <main className="pane-area">
        {open.map((id) => (
          <TerminalPane
            key={id}
            session={id}
            label={byId.get(id)?.name ?? id}
            visible={id === selected}
            attempt={attempts[id] ?? 0}
            onStatus={(s, st) => status.current.set(s, st)}
            onReattach={reattach}
          />
        ))}
        {selected === null && <p className="pane-empty">Select a session to open it here.</p>}
        {newIn && (
          <NewSessionBox
            key={newIn.key}
            cwd={newIn.key}
            label={newIn.label}
            sessions={sessions}
            onStarted={select}
            onClose={() => setNewIn(null)}
          />
        )}
      </main>
    </div>
  );
}
