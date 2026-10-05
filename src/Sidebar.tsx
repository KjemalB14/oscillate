import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { ago, useNow } from "./ago";
import { useAvatar } from "./avatars";
import { groupSessions, type RepoGroup } from "./groups";
import { MAX_WIDTH, MIN_WIDTH, type Layout } from "./layout";
import { STOPPABLE, type RowAction, type RowActions } from "./rowActions";
import type { Pr, Session, UiState } from "./sessions";

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

export function stateWords(s: Session): string {
  return s.state === "unknown" && s.rawState ? `unknown (${s.rawState})` : STATE_WORDS[s.state];
}

/** Working's 3×3 cells, each with its diagonal (0–4), which sets its place in the wave. */
const CELLS = Array.from({ length: 9 }, (_, i) => (
  <span key={i} className="cell" style={{ "--diagonal": (i % 3) + Math.floor(i / 3) } as CSSProperties} />
));

/**
 * The state indicator, moving as zeron's does: working is a 3×3 grid with a phase wave,
 * needs you breathes, and the rest are still dots. All are still under reduced motion.
 */
export function StateDot({ session }: { session: Session }) {
  const words = stateWords(session);
  return (
    <span className="dot" role="img" aria-label={words} title={words}>
      {session.state === "working" && CELLS}
    </span>
  );
}

/**
 * A group's avatar: its GitHub owner's image, else a folder glyph. While it's asked for,
 * it's an empty box of the same size, so the label doesn't shift. None of the three is a
 * `span`, because specs read a header's spans as chevron, label, count.
 */
function RepoAvatar({ cwd }: { cwd: string }) {
  const url = useAvatar(cwd);
  if (url) return <img className="avatar" data-avatar="image" src={url} alt="" draggable={false} />;
  return (
    <svg className="avatar" data-avatar={url === null ? "folder" : "pending"} viewBox="0 0 16 16" aria-hidden="true">
      {url === null && (
        <path d="M2.5 4.5a1 1 0 0 1 1-1h2.8l1.4 1.4h4.8a1 1 0 0 1 1 1v5.6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
      )}
    </svg>
  );
}

/** Opens a PR in the default browser; Rust opens only links a listed session names. */
function openPr(pr: Pr) {
  invoke("open_pr", { href: pr.href }).catch((e) => console.error("open_pr:", e));
}

/**
 * A row's PR links: the newest as `#N`, then `+k` for the rest, which opens a menu of
 * them, newest first. Clicks and keys here never select the row.
 */
export function PrChips({ prs, name, onMore }: { prs: Pr[]; name: string; onMore: (e: ReactMouseEvent<HTMLButtonElement>) => void }) {
  if (prs.length === 0) return null;
  const newest = prs[prs.length - 1];
  const rest = prs.length - 1;
  const own = (act: (e: ReactMouseEvent<HTMLButtonElement>) => void) => (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    act(e);
  };
  return (
    <span className="prs" onKeyDown={(e) => e.stopPropagation()}>
      <button className="pr" aria-label={`PR #${newest.number}`} title={newest.href} onClick={own(() => openPr(newest))}>
        #{newest.number}
      </button>
      {rest > 0 && (
        <button
          className="pr pr-more"
          aria-label={`${rest} more PRs from ${name}`}
          aria-haspopup="menu"
          title={`${rest} more PRs`}
          onClick={own(onMore)}
        >
          +{rest}
        </button>
      )}
    </span>
  );
}

interface RowProps {
  session: Session;
  selected: boolean;
  /** The clock the row's time is measured against (`useNow`). */
  now: number;
  onSelect: (id: string) => void;
  /** Stop or Remove under way, Remove's confirm, or a failure to show. */
  action: RowAction | undefined;
  /** A right-click: opens the row's menu. Terminal-tab rows have none. */
  onMenu: (session: Session, e: ReactMouseEvent<HTMLLIElement>) => void;
  onConfirmRemove: (id: string) => void;
  onDismiss: (id: string) => void;
  /** `+k`: opens the menu of the row's older PRs. */
  onMorePrs: (session: Session, e: ReactMouseEvent<HTMLButtonElement>) => void;
}

/**
 * Two lines. Line 1 is the indicator, the name, and the time since the last activity.
 * Line 2 is what it's waiting for, else the state's words, with the PR chips at its end.
 * The repo is the group's header, so it's not on the row.
 */
function SessionRow({ session, selected, now, onSelect, action, onMenu, onConfirmRemove, onDismiss, onMorePrs }: RowProps) {
  const terminalTab = session.state === "terminal-tab";
  const running = action?.kind === "running" ? (action.end === "stop" ? "Stopping…" : "Removing…") : null;
  const detail = terminalTab ? "run /bg to open here" : running ?? session.waitingFor ?? stateWords(session);
  const updated = session.updatedAt;
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
        <StateDot session={session} />
        <span className="name">{name}</span>
        {updated != null && (
          <time className="when" dateTime={new Date(updated).toISOString()} title={`Last active ${new Date(updated).toLocaleString()}`}>
            {ago(updated, now)}
          </time>
        )}
        <span className="detail">{detail}</span>
        <PrChips prs={session.prs ?? []} name={name} onMore={(e) => onMorePrs(session, e)} />
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
 * A small menu at a point, kept inside the window as a native menu is. It focuses its
 * first item, and closes on Escape, a click elsewhere, or the window losing focus.
 */
function FloatingMenu({ x, y, label, onClose, children }: {
  x: number;
  y: number;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
  }, [x, y]);

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
  }, [x, y]);

  return (
    <div ref={ref} className="row-menu" role="menu" aria-label={label} style={pos}>
      {children}
    </div>
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

/** A row's context menu: Stop while the session is live, Remove always. */
function RowMenu({ at, onStop, onRemove, onClose }: {
  at: MenuAt;
  onStop: (id: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const choose = (act: (id: string) => void) => () => {
    onClose();
    act(at.id);
  };
  return (
    <FloatingMenu x={at.x} y={at.y} label={`${at.name} actions`} onClose={onClose}>
      {at.live && (
        <button role="menuitem" onClick={choose(onStop)}>
          Stop
        </button>
      )}
      <button role="menuitem" onClick={choose(onRemove)}>
        Remove
      </button>
    </FloatingMenu>
  );
}

/** Where a `+k` menu opened: a session's older PRs, newest first. */
export interface PrMenuAt {
  name: string;
  prs: Pr[];
  x: number;
  y: number;
}

/** The `+k` menu for `session`, under the chip that was clicked. */
export function prMenuAt(session: Session, e: ReactMouseEvent<HTMLButtonElement>): PrMenuAt {
  const chip = e.currentTarget.getBoundingClientRect();
  return {
    name: session.name ?? session.id ?? "",
    prs: session.prs.slice(0, -1).reverse(),
    x: chip.left,
    y: chip.bottom + 2,
  };
}

export function PrMenu({ at, onClose }: { at: PrMenuAt; onClose: () => void }) {
  return (
    <FloatingMenu x={at.x} y={at.y} label={`More PRs from ${at.name}`} onClose={onClose}>
      {at.prs.map((pr) => (
        <button
          role="menuitem"
          key={pr.href}
          title={pr.href}
          onClick={() => {
            onClose();
            openPr(pr);
          }}
        >
          #{pr.number}
        </button>
      ))}
    </FloatingMenu>
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
  /** The width, collapse and edge drag (`src/layout.ts`). */
  layout: Layout;
}

/** Two clicks on the edge within this reset it, as macOS's default double-click interval. */
const DOUBLE_CLICK_MS = 500;

/**
 * The sidebar's right edge: drag to resize within `MIN_WIDTH`–`MAX_WIDTH`, double-click
 * to reset. The width is saved once, when the drag ends.
 *
 * Mouse events on the window, not pointer capture: WebDriver's drag in WKWebView sends
 * only a mousedown and a mouseup, so the release's position counts as a move too. Its
 * double-click is two clicks and no `dblclick`, so two clicks close together reset.
 */
function ResizeHandle({ layout }: { layout: Layout }) {
  const lastClick = useRef(0);
  // A press that moved was a drag; its click counts toward no double-click.
  const dragged = useRef(false);
  const onClick = () => {
    const now = performance.now();
    if (dragged.current) {
      lastClick.current = 0;
      return;
    }
    if (now - lastClick.current < DOUBLE_CLICK_MS) {
      lastClick.current = 0;
      layout.reset();
    } else lastClick.current = now;
  };
  const drag = useRef(layout.drag);
  drag.current = layout.drag;
  const commit = useRef(layout.commit);
  commit.current = layout.commit;
  const onMouseDown = (down: ReactMouseEvent<HTMLDivElement>) => {
    if (down.button !== 0 || down.detail > 1) return; // a double-click's second press resets
    down.preventDefault();
    const from = { x: down.clientX, width: layout.width };
    const to = (e: MouseEvent) => drag.current(from.width + e.clientX - from.x);
    const up = (e: MouseEvent) => {
      dragged.current = e.clientX !== from.x;
      window.removeEventListener("mousemove", to);
      window.removeEventListener("mouseup", up);
      delete document.documentElement.dataset.resizing;
      commit.current(from.width + e.clientX - from.x);
    };
    document.documentElement.dataset.resizing = "";
    window.addEventListener("mousemove", to);
    window.addEventListener("mouseup", up);
  };
  return (
    <div
      className="sidebar-edge"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={layout.width}
      onMouseDown={onMouseDown}
      onClick={onClick}
    />
  );
}

/** The sidebar toggle: in the sidebar's title strip when open, in the header when not. */
export function SidebarToggle({ onToggle }: { onToggle: () => void }) {
  return (
    <button className="sidebar-toggle" aria-label="Toggle sidebar" title="Toggle sidebar (⌃⌘S)" onClick={onToggle}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect x="1.5" y="2.5" width="13" height="11" rx="2.5" />
        <line x1="6" y1="2.5" x2="6" y2="13.5" />
      </svg>
    </button>
  );
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
  layout,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const [prMenu, setPrMenu] = useState<PrMenuAt | null>(null);
  const now = useNow();
  const scroller = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState("");
  // The list fades at whichever edge hides rows: on scroll, and whenever rows change.
  const measureFade = () => {
    const el = scroller.current;
    if (!el) return;
    const edges = [];
    if (el.scrollTop > 0) edges.push("top");
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 1) edges.push("bottom");
    setFade(edges.join(" "));
  };
  useLayoutEffect(measureFade);
  useEffect(() => {
    window.addEventListener("resize", measureFade);
    return () => window.removeEventListener("resize", measureFade);
  }, []);
  const openPrMenu = (session: Session, e: ReactMouseEvent<HTMLButtonElement>) => setPrMenu(prMenuAt(session, e));
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
              <RepoAvatar cwd={group.key} />
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
                  now={now}
                  onSelect={onSelect}
                  action={s.id ? rowActions.actions.get(s.id) : undefined}
                  onMenu={openMenu}
                  onConfirmRemove={rowActions.confirmRemove}
                  onDismiss={rowActions.dismiss}
                  onMorePrs={openPrMenu}
                />
              ))}
            </ul>
          )}
        </section>
      );
    });
  }

  return (
    <nav className="sidebar" aria-label="Sessions" data-collapsed={layout.collapsed || undefined} inert={layout.collapsed}>
      <div className="sidebar-strip" data-tauri-drag-region>
        {!layout.collapsed && <SidebarToggle onToggle={layout.toggle} />}
      </div>
      <div
        ref={scroller}
        className="sidebar-scroll"
        data-fade={fade || undefined}
        onScroll={() => {
          setMenu(null);
          setPrMenu(null);
          measureFade();
        }}
      >
        {trust && (
          <button className="trust-entry" aria-current={trust.selected || undefined} onClick={onShowTrust}>
            Trust prompt · {trust.label}
          </button>
        )}
        {body}
        <button className="add-repo" onClick={onAddRepo}>
          Add repo…
        </button>
      </div>
      {menu && (
        <RowMenu
          at={menu}
          onStop={rowActions.stop}
          onRemove={rowActions.askRemove}
          onClose={() => setMenu(null)}
        />
      )}
      {prMenu && <PrMenu at={prMenu} onClose={() => setPrMenu(null)} />}
      {!layout.collapsed && <ResizeHandle layout={layout} />}
    </nav>
  );
}
