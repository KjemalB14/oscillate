import { useEffect, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";
import { groupSessions, type RepoGroup } from "./groups";
import { useLayout } from "./layout";
import { NewSessionBox, type Mode } from "./NewSessionBox";
import { PaneHeader } from "./PaneHeader";
import type { TrustInfo } from "./pty";
import { useAddedRepos } from "./repos";
import { useRowActions } from "./rowActions";
import { Sidebar } from "./Sidebar";
import { TerminalPane, type PaneStatus } from "./TerminalPane";
import { TrustPane } from "./TrustPane";
import { useSessions } from "./sessions";

/**
 * Live panes at most. Opening one more closes the least recently viewed, never the
 * visible one; reopening it costs one recap. Held to a measured budget
 * (NOTES.md, *Chapter 2 closed*).
 */
export const PANE_CAP = 6;

/** `selected` while the trust pane shows; never a session id, which is alphanumeric. */
const TRUST = ":trust";

/** How long the quit refusal stays up. */
const REFUSAL_MS = 5000;

/** The prompt box: its group, and what it opens with (after the trust pane, a retry). */
interface BoxFor {
  key: string;
  label: string;
  initial?: { prompt: string; mode: Mode; retry: boolean; error?: string };
}

export default function App() {
  const sessions = useSessions();
  const repos = useAddedRepos();
  const rowActions = useRowActions();
  const layout = useLayout();
  const toggleSidebar = useRef(layout.toggle);
  toggleSidebar.current = layout.toggle;
  // The group whose "+" prompt box is open; one box at a time.
  const [newIn, setNewIn] = useState<BoxFor | null>(null);
  // The start waiting on the trust pane; at most one.
  const [trust, setTrust] = useState<TrustInfo | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  // Bumped each time the trust pane is asked for, so it takes focus even when showing.
  const [trustFocus, setTrustFocus] = useState(0);
  const showTrust = () => {
    setSelected(TRUST);
    setTrustFocus((n) => n + 1);
  };
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

  // A tapped notification opens its session as a row click does. The ref keeps the
  // listener from calling a `select` that closed over an old `open`.
  const selectRef = useRef(select);
  selectRef.current = select;
  useEffect(() => {
    const unlisten = listen<string>("open-session", (e) => selectRef.current(e.payload));
    return () => void unlisten.then((f) => f());
  }, []);

  // Rust doesn't notify for the session on screen, and opening one removes its
  // notification. A reload starts at null, which clears what Rust had.
  useEffect(() => {
    invoke("set_visible_session", { id: selected === TRUST ? null : selected }).catch((e) =>
      console.error("set_visible_session:", e),
    );
  }, [selected]);

  // A session that is no longer listed loses its pane (Rust has already closed its PTY).
  useEffect(() => {
    if (!sessions) return;
    const listed = new Set(sessions.map((s) => s.id));
    setOpen((prev) => (prev.every((id) => listed.has(id)) ? prev : prev.filter((id) => listed.has(id))));
    setSelected((id) => (id && id !== TRUST && !listed.has(id) ? null : id));
  }, [sessions]);

  // A reloaded page finds a trust pane that is still open; Rust kept it.
  useEffect(() => {
    invoke<TrustInfo | null>("trust_current").then((info) => info && setTrust(info));
  }, []);

  // While the trust pane is open, quitting is refused (in Rust); this says why. Cmd+Q
  // pressed in the page is sent to Rust too, since the menu never sees it.
  useEffect(() => {
    let timer: number | undefined;
    const unlisten = listen<string>("quit-refused", (e) => {
      setRefused(e.payload);
      showTrust();
      clearTimeout(timer);
      timer = setTimeout(() => setRefused(null), REFUSAL_MS);
    });
    // ⌃⌘S toggles the sidebar (the macOS convention). Like ⌘Q, it's taken here, in the
    // capture phase, so it never reaches a terminal or its PTY.
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      const key = e.key.toLowerCase();
      if (e.ctrlKey && key === "s") {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) toggleSidebar.current();
        return;
      }
      if (key !== "q") return;
      e.preventDefault();
      e.stopPropagation();
      invoke("quit").catch(() => {}); // a refusal arrives as `quit-refused`
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      clearTimeout(timer);
      void unlisten.then((f) => f());
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  // "+" while the trust pane is open shows it and starts nothing: one trust at a time.
  const newSession = (group: RepoGroup) => {
    if (trust) showTrust();
    else setNewIn({ key: group.key, label: group.label });
  };

  const untrusted = (box: BoxFor, prompt: string, mode: Mode) => {
    setTrust({ cwd: box.key, label: box.label, prompt, mode: mode || null });
    setNewIn(null);
    showTrust();
  };

  // The trust `claude` exited: the box reopens and retries once, with what it kept.
  const trustEnded = (info: TrustInfo, error?: string) => {
    setTrust(null);
    setSelected((id) => (id === TRUST ? null : id));
    const initial = { prompt: info.prompt, mode: (info.mode ?? "") as Mode, retry: !error, error };
    setNewIn({ key: info.cwd, label: info.label, initial });
  };

  const byId = new Map((sessions ?? []).map((s) => [s.id, s]));
  const shown = (selected && selected !== TRUST && byId.get(selected)) || null;
  const shownRepo = shown
    ? groupSessions(sessions ?? [], repos.list).find((g) => g.sessions.includes(shown))?.label ?? null
    : null;
  return (
    <div
      className="app"
      data-layout={layout.loaded ? "ready" : undefined}
      style={
        {
          "--sidebar-width": `${layout.collapsed ? 0 : layout.width}px`,
          "--sidebar-open-width": `${layout.width}px`,
        } as CSSProperties
      }
    >
      <Sidebar
        sessions={sessions}
        selected={selected}
        onSelect={select}
        added={repos.list}
        onAddRepo={repos.add}
        onRemoveRepo={repos.remove}
        onNewSession={newSession}
        trust={trust && { label: trust.label, selected: selected === TRUST }}
        onShowTrust={showTrust}
        rowActions={rowActions}
        layout={layout}
      />
      <main className="pane-area">
        <PaneHeader
          session={shown}
          repo={shownRepo}
          trust={selected === TRUST && trust ? trust.label : null}
          collapsed={layout.collapsed}
          onToggle={layout.toggle}
        />
        <div className="pane-stack">
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
          {trust && (
            <TrustPane
              key={trust.cwd}
              info={trust}
              visible={selected === TRUST}
              focusRequest={trustFocus}
              onExit={() => trustEnded(trust)}
              onFailed={(message) => trustEnded(trust, message)}
            />
          )}
          {selected === null && <p className="pane-empty">Select a session to open it here.</p>}
          {newIn && (
            <NewSessionBox
              key={`${newIn.key}:${newIn.initial ? "retry" : "new"}`}
              cwd={newIn.key}
              label={newIn.label}
              sessions={sessions}
              initial={newIn.initial}
              onStarted={select}
              onUntrusted={(prompt, mode) => untrusted(newIn, prompt, mode)}
              onClose={() => setNewIn(null)}
            />
          )}
          {refused && (
            <p className="quit-refused" role="alert">
              {refused}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
