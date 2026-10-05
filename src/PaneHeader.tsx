import { useState } from "react";
import type { Session } from "./sessions";
import { PrChips, PrMenu, prMenuAt, SidebarToggle, stateWords, type PrMenuAt } from "./Sidebar";

interface Props {
  /** The session whose pane shows, if any. */
  session: Session | null;
  /** Its group's label: the repo the sidebar files it under. */
  repo: string | null;
  /** The trust pane's repo while it shows, instead of a session. */
  trust: string | null;
  /** Collapsed, the sidebar's toggle lives here, after the traffic lights. */
  collapsed: boolean;
  onToggle: () => void;
}

/**
 * The bar above the panes, in the title bar's place: the selected session's name, its
 * repo, its state and its PR chips. Its empty space drags the window. With nothing
 * selected, it's empty.
 */
export function PaneHeader({ session, repo, trust, collapsed, onToggle }: Props) {
  const [prMenu, setPrMenu] = useState<PrMenuAt | null>(null);
  const name = session && (session.name ?? session.id ?? "");
  return (
    <header
      className={`pane-header${session ? ` state-${session.state}` : ""}`}
      aria-label="Session"
      data-collapsed={collapsed || undefined}
      data-tauri-drag-region
    >
      {collapsed && <SidebarToggle onToggle={onToggle} />}
      {session && (
        <>
          <span className="dot" role="img" aria-label={stateWords(session)} title={stateWords(session)} />
          <span className="header-name">{name}</span>
          {repo && <span className="header-repo">{repo}</span>}
          <span className="header-state">{stateWords(session)}</span>
          <PrChips prs={session.prs ?? []} name={name!} onMore={(e) => setPrMenu(prMenuAt(session, e))} />
        </>
      )}
      {!session && trust && <span className="header-name">Trust prompt · {trust}</span>}
      {prMenu && <PrMenu at={prMenu} onClose={() => setPrMenu(null)} />}
    </header>
  );
}
