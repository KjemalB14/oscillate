import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { groupSessions, type RepoGroup } from "./groups";
import { STOPPABLE, type RowAction, type RowActions } from "./rowActions";
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
  /** Stop or Remove under way, Remove's confirm, or a failure to show. */
  action: RowAction | undefined;
  /** A right-click: opens the row's menu. Terminal-tab rows have none. */
  onMenu: (session: Session, e: ReactMouseEvent<HTMLLIElement>) => void;
  onConfirmRemove: (id: string) => void;
  onDismiss: (id: string) => void;
}

function SessionRow({ session, selected, onSelect, action, onMenu, onConfirmRemove, onDismiss }: RowProps) {
  const terminalTab = session.state === "terminal-tab";
  const running = action?.kind === "running" ? (action.end === "stop" ? "Stopping…" : "Removing…") : null;
  const detail = terminalTab ? "run /bg to open here" : running ?? session.waitingFor;
  const id = session.id;
  const name = session.name ?? session.id ?? "Terminal session";
  return (
    <>
      <li
        className={`session state-${session.state}`}
        aria-disabled={terminalTab || undefined}
        aria-current={selected || undefined}
        tabIndex={id ? 0 : undefined}
        onClick={id ? () => onSelect(id) : undefined}
        onKeyDown={
          id ? (e) => (e.key === "Enter" || e.key === " ") && onSelect(id) : undefined
        }
        onContextMenu={(e) => {
          // WKWebView's own menu (Reload, in a release build) never shows on a row.
          e.preventDefault();
          if (id) onMenu(session, e);
        }}
        title={terminalTab ? "Started in a terminal tab. Run /bg there to open it here." : undefined}
      >
        <span className="dot" role="img" aria-label={stateWords(session)} title={stateWords(session)} />
        <span className="name">{name}</span>
        {detail && <span className="detail">{detail}</span>}
      </li>
      {id && action?.kind === "confirm" && (
        <li
          className="row-confirm"
          role="group"
          aria-label={`Remove ${name}?`}
          onKeyDown={(e) => e.key === "Escape" && onDismiss(id)}
        >
          <span className="row-confirm-text">Remove {name}?</span>
          <button className="row-confirm-remove" onClick={() => onConfirmRemove(id)}>
            Remove
          </button>
          <button autoFocus onClick={() => onDismiss(id)}>
            Cancel
          </button>
        </li>
      )}
      {id && action?.kind === "failed" && (
        <li className="row-error">
          <pre role="alert">{action.message}</pre>
          <button aria-label="Dismiss" title="Dismiss" onClick={() => onDismiss(id)}>
            ×
          </button>
        </li>
      )}
    </>
  );
}

/** Where a row's menu opened, and for which session. */
interface MenuAt {
  id: string;
  name: string;
  live: boolean;
  x: number;
  y: number;
}

/**
 * A row's context menu: Stop while the session is live, Remove always. It closes on a
 * choice, Escape, a click elsewhere, or the window losing focus.
 */
function RowMenu({ at, onStop, onRemove, onClose }: {
  at: MenuAt;
  onStop: (id: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });

  // Kept inside the window, as a native menu is.
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(at.x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(at.y, window.innerHeight - r.height - 4)),
    });
  }, [at]);

  useEffect(() => {
    ref.current?.querySelector("button")?.focus();
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", away, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", away, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", onClose);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at]);

  const choose = (act: (id: string) => void) => () => {
    onClose();
    act(at.id);
  };
  return (
    <div ref={ref} className="row-menu" role="menu" aria-label={`${at.name} actions`} style={pos}>
      {at.live && (
        <button role="menuitem" onClick={choose(onStop)}>
          Stop
        </button>
      )}
      <button role="menuitem" onClick={choose(onRemove)}>
        Remove
      </button>
    </div>
  );
}

interface SidebarProps {
  sessions: Session[] | null;
  /** The id of the session whose pane is showing. */
  selected: string | null;
  onSelect: (id: string) => void;
  /** Canonical paths added with "Add repo…"; each keeps a group with no sessions. */
  added: string[];
  onAddRepo: () => void;
  onRemoveRepo: (path: string) => void;
  /** "+": opens the prompt box for a new session in the group's `cwd`. */
  onNewSession: (group: RepoGroup) => void;
  /** The open trust pane, if any: its repo's label, and whether it's showing. */
  trust: { label: string; selected: boolean } | null;
  onShowTrust: () => void;
  /** Stop and Remove, from a background row's context menu. */
  rowActions: RowActions;
}

export function Sidebar({
  sessions,
  selected,
  onSelect,
  added,
  onAddRepo,
  onRemoveRepo,
  onNewSession,
  trust,
  onShowTrust,
  rowActions,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const openMenu = (session: Session, e: ReactMouseEvent<HTMLLIElement>) => {
    const id = session.id!;
    // Not while its Stop or Remove runs; there is nothing more to ask of it.
    if (rowActions.actions.get(id)?.kind === "running") return setMenu(null);
    // A keyboard-opened menu has no pointer position; it opens under the row.
    const row = e.currentTarget.getBoundingClientRect();
    const keyboard = e.clientX === 0 && e.clientY === 0;
    setMenu({
      id,
      name: session.name ?? id,
      live: STOPPABLE.has(session.state),
      x: keyboard ? row.left + 18 : e.clientX,
      y: keyboard ? row.bottom : e.clientY,
    });
  };
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  let body;
  if (sessions === null) {
    body = <p className="sidebar-note">Looking for sessions…</p>;
  } else if (sessions.length === 0 && added.length === 0) {
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
    body = groupSessions(sessions, added).map((group) => {
      const open = !collapsed.has(group.key);
      const listId = `group-${group.key || "none"}`;
      return (
        <section className="group" key={group.key} aria-label={group.label}>
          <div className="group-bar">
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
            {group.added && (
              <button
                className="group-action"
                aria-label="Remove from list"
                title="Remove from list"
                onClick={() => onRemoveRepo(group.key)}
              >
                ×
              </button>
            )}
            {group.key && (
              <button
                className="group-action"
                aria-label={`New session in ${group.label}`}
                title={`New session in ${group.key}`}
                onClick={() => onNewSession(group)}
              >
                +
              </button>
            )}
          </div>
          {open && (
            <ul className="sessions" id={listId}>
              {group.sessions.map((s) => (
                <SessionRow
                  session={s}
                  key={s.key}
                  selected={s.id !== null && s.id === selected}
                  onSelect={onSelect}
                  action={s.id ? rowActions.actions.get(s.id) : undefined}
                  onMenu={openMenu}
                  onConfirmRemove={rowActions.confirmRemove}
                  onDismiss={rowActions.dismiss}
                />
              ))}
            </ul>
          )}
        </section>
      );
    });
  }

  return (
    <nav className="sidebar" aria-label="Sessions" onScroll={() => setMenu(null)}>
      {trust && (
        <button className="trust-entry" aria-current={trust.selected || undefined} onClick={onShowTrust}>
          Trust prompt · {trust.label}
        </button>
      )}
      {body}
      <button className="add-repo" onClick={onAddRepo}>
        Add repo…
      </button>
      {menu && (
        <RowMenu
          at={menu}
          onStop={rowActions.stop}
          onRemove={rowActions.askRemove}
          onClose={() => setMenu(null)}
        />
      )}
    </nav>
  );
}
