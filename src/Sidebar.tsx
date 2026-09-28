import { useState } from "react";
import { groupSessions } from "./groups";
import type { Session, UiState } from "./sessions";

/** The words for each state: the dot's accessible name and its tooltip. */
const STATE_WORDS: Record<UiState, string> = {
  working: "working",
  "needs-you": "needs you",
  done: "done",
  failed: "failed",
  stopped: "stopped",
  paused: "paused",
  "terminal-tab": "terminal tab",
  unknown: "unknown",
};

function stateWords(s: Session): string {
  return s.state === "unknown" && s.rawState ? `unknown (${s.rawState})` : STATE_WORDS[s.state];
}

interface RowProps {
  session: Session;
  selected: boolean;
  onSelect: (id: string) => void;
}

function SessionRow({ session, selected, onSelect }: RowProps) {
  const terminalTab = session.state === "terminal-tab";
  const detail = terminalTab ? "run /bg to open here" : session.waitingFor;
  const id = session.id;
  return (
    <li
      className={`session state-${session.state}`}
      aria-disabled={terminalTab || undefined}
      aria-current={selected || undefined}
      tabIndex={id ? 0 : undefined}
      onClick={id ? () => onSelect(id) : undefined}
      onKeyDown={
        id ? (e) => (e.key === "Enter" || e.key === " ") && onSelect(id) : undefined
      }
      title={terminalTab ? "Started in a terminal tab. Run /bg there to open it here." : undefined}
    >
      <span className="dot" role="img" aria-label={stateWords(session)} title={stateWords(session)} />
      <span className="name">{session.name ?? session.id ?? "Terminal session"}</span>
      {detail && <span className="detail">{detail}</span>}
    </li>
  );
}

interface SidebarProps {
  sessions: Session[] | null;
  /** The id of the session whose pane is showing. */
  selected: string | null;
  onSelect: (id: string) => void;
}

export function Sidebar({ sessions, selected, onSelect }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  let body;
  if (sessions === null) {
    body = <p className="sidebar-note">Looking for sessions…</p>;
  } else if (sessions.length === 0) {
    body = (
      <div className="sidebar-empty">
        <p>No sessions.</p>
        <p>
          Start one with <code>claude --bg</code>, or run <code>/bg</code> in a Claude
          session.
        </p>
      </div>
    );
  } else {
    body = groupSessions(sessions).map((group) => {
      const open = !collapsed.has(group.key);
      const listId = `group-${group.key || "none"}`;
      return (
        <section className="group" key={group.key} aria-label={group.label}>
          <button
            className="group-header"
            aria-expanded={open}
            aria-controls={listId}
            title={group.key || undefined}
            onClick={() => toggle(group.key)}
          >
            <span className="chevron" aria-hidden="true" />
            <span className="label">{group.label}</span>
            <span className="count">{group.sessions.length}</span>
          </button>
          {open && (
            <ul className="sessions" id={listId}>
              {group.sessions.map((s) => (
                <SessionRow
                  session={s}
                  key={s.key}
                  selected={s.id !== null && s.id === selected}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          )}
        </section>
      );
    });
  }

  return (
    <nav className="sidebar" aria-label="Sessions">
      {body}
    </nav>
  );
}
