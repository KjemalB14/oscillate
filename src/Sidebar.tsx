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

function SessionRow({ session }: { session: Session }) {
  const terminalTab = session.state === "terminal-tab";
  const detail = terminalTab ? "run /bg to open here" : session.waitingFor;
  return (
    <li
      className={`session state-${session.state}`}
      aria-disabled={terminalTab || undefined}
      title={terminalTab ? "Started in a terminal tab. Run /bg there to open it here." : undefined}
    >
      <span className="dot" role="img" aria-label={stateWords(session)} title={stateWords(session)} />
      <span className="name">{session.name ?? session.id ?? "Terminal session"}</span>
      {detail && <span className="detail">{detail}</span>}
    </li>
  );
}

export function Sidebar({ sessions }: { sessions: Session[] | null }) {
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
                <SessionRow session={s} key={s.key} />
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
