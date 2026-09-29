import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "./sessions";

/** The mode picker's choices; "" is Default, which passes no flag. No `bypassPermissions`. */
export const MODES = ["", "plan", "acceptEdits", "auto", "manual", "dontAsk"] as const;

/** How long a started session may take to be listed before the box says so. */
const LIST_WAIT_MS = 10_000;

interface Props {
  cwd: string;
  label: string;
  sessions: Session[] | null;
  /** Selects and attaches the new session, through the pane pool. */
  onStarted: (id: string) => void;
  onClose: () => void;
}

type Phase =
  | { kind: "editing" }
  | { kind: "starting" }
  | { kind: "waiting"; id: string }
  | { kind: "unlisted"; id: string }
  | { kind: "failed"; message: string };

/**
 * The "+" prompt box: `claude --bg [--permission-mode <m>] <prompt>` in the group's
 * `cwd`. Once the new id is listed, it is selected and attached; a failure is shown
 * verbatim, and the prompt and mode stay for another try.
 */
export function NewSessionBox({ cwd, label, sessions, onStarted, onClose }: Props) {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<(typeof MODES)[number]>("");
  const [phase, setPhase] = useState<Phase>({ kind: "editing" });
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => promptRef.current?.focus(), []);

  const busy = phase.kind === "starting" || phase.kind === "waiting";
  const canSubmit = !busy && prompt.trim() !== "";

  const submit = () => {
    if (!canSubmit) return;
    setPhase({ kind: "starting" });
    invoke<string>("start_session", { cwd, mode: mode || null, prompt })
      .then((id) => setPhase({ kind: "waiting", id }))
      .catch((e) => setPhase({ kind: "failed", message: String(e) }));
  };

  // The new session opens once it's listed; after LIST_WAIT_MS the box says so instead.
  const waitingFor = phase.kind === "waiting" ? phase.id : null;
  useEffect(() => {
    if (!waitingFor) return;
    if (sessions?.some((s) => s.id === waitingFor)) {
      onStarted(waitingFor);
      onClose();
    }
  }, [waitingFor, sessions]);
  useEffect(() => {
    if (!waitingFor) return;
    const timer = setTimeout(() => setPhase({ kind: "unlisted", id: waitingFor }), LIST_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waitingFor]);

  return (
    <div className="new-session" role="dialog" aria-label={`New session in ${label}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) onClose();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
      >
        <h2 title={cwd}>New session in {label}</h2>
        <textarea
          ref={promptRef}
          aria-label="Prompt"
          placeholder="What should Claude do?"
          rows={6}
          value={prompt}
          disabled={busy}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <fieldset className="modes" disabled={busy}>
          <legend>Permission mode</legend>
          {MODES.map((m) => (
            <label key={m}>
              <input
                type="radio"
                name="permission-mode"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
              />
              {m || "Default"}
            </label>
          ))}
        </fieldset>
        <div className="new-session-row">
          <span className="spacer" />
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" disabled={!canSubmit}>
            {busy ? "Starting…" : "Start"}
          </button>
        </div>
        {phase.kind === "failed" && (
          <pre className="new-session-error" role="alert">
            {phase.message}
          </pre>
        )}
        {phase.kind === "unlisted" && (
          <p className="new-session-error" role="alert">
            Started session {phase.id}, but it isn't listed after {LIST_WAIT_MS / 1000}s, so
            nothing was opened.
          </p>
        )}
      </form>
    </div>
  );
}
