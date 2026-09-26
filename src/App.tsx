import "./App.css";
import { Sidebar } from "./Sidebar";
import { TerminalPane } from "./TerminalPane";
import { useSessions } from "./sessions";

export default function App() {
  const sessions = useSessions();
  return (
    <div className="app">
      <Sidebar sessions={sessions} />
      <main className="pane-area">
        <TerminalPane />
      </main>
    </div>
  );
}
