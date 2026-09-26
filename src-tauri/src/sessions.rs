//! What the sidebar shows for each entry of `claude agents --json --all` (invariant 2).
//!
//! The shapes below were read from Claude Code 2.1.282's `printAgentsJson`:
//! - Background entries have `id`, `cwd`, `kind`, `startedAt`, `sessionId` and `state`
//!   (`working | blocked | done | failed | stopped`), maybe `name`, and `pid` and
//!   `status` (`busy | idle | waiting`) only while a process is live. `waitingFor` comes
//!   only with `status: waiting`.
//! - Interactive entries, and background processes with no job, have no `id` and no
//!   `state`, so they can't be attached.
//!
//! Every field is optional except `kind`, so a new or missing field never fails a poll.

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEntry {
    pub kind: String,
    pub id: Option<String>,
    pub cwd: Option<String>,
    pub name: Option<String>,
    pub state: Option<String>,
    pub status: Option<String>,
    pub waiting_for: Option<String>,
    pub session_id: Option<String>,
    pub pid: Option<u64>,
    pub started_at: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum UiState {
    Working,
    NeedsYou,
    Done,
    Failed,
    Stopped,
    /// Not finished, but not running a turn either: idle, or no live process.
    Paused,
    /// Not a background job, so there is nothing to attach; "run /bg to open here".
    TerminalTab,
    /// A `state` this version doesn't know; `raw_state` has it.
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    /// Stable across polls: `id`, else `sessionId`, else `pid:<pid>`.
    pub key: String,
    /// What `claude attach` takes; `None` for a terminal-tab session.
    pub id: Option<String>,
    pub name: Option<String>,
    pub cwd: String,
    pub kind: String,
    pub state: UiState,
    pub raw_state: Option<String>,
    pub waiting_for: Option<String>,
    pub started_at: i64,
}

pub fn to_session(e: &AgentEntry) -> Session {
    let state = match (&e.id, e.state.as_deref(), e.status.as_deref()) {
        (None, _, _) => UiState::TerminalTab,
        (_, Some("blocked"), _) => UiState::NeedsYou,
        (_, Some("working"), Some("busy")) => UiState::Working,
        (_, Some("working"), _) => UiState::Paused,
        (_, Some("done"), _) => UiState::Done,
        (_, Some("failed"), _) => UiState::Failed,
        (_, Some("stopped"), _) => UiState::Stopped,
        _ => UiState::Unknown,
    };
    let key = e
        .id
        .clone()
        .or_else(|| e.session_id.clone())
        .or_else(|| e.pid.map(|pid| format!("pid:{pid}")))
        .unwrap_or_else(|| {
            format!("{}@{}", e.cwd.as_deref().unwrap_or(""), e.started_at.unwrap_or(0.0))
        });
    Session {
        key,
        id: e.id.clone(),
        name: e.name.clone(),
        cwd: e.cwd.clone().unwrap_or_default(),
        kind: e.kind.clone(),
        state,
        raw_state: e.state.clone(),
        waiting_for: e.waiting_for.clone(),
        started_at: e.started_at.unwrap_or(0.0) as i64,
    }
}

/// Parses the CLI's output, keeping its order. Anything but a JSON array is an error; an
/// entry that doesn't fit is skipped with one log line rather than failing the poll.
pub fn parse(json: &[u8]) -> Result<Vec<Session>, String> {
    let entries: Vec<serde_json::Value> =
        serde_json::from_slice(json).map_err(|e| format!("agents --json isn't an array: {e}"))?;
    Ok(entries
        .into_iter()
        .filter_map(|value| match serde_json::from_value::<AgentEntry>(value) {
            Ok(entry) => Some(to_session(&entry)),
            Err(e) => {
                eprintln!("oscillate: skipping an agents --json entry: {e}");
                None
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Vec<u8> {
        let path = format!("{}/fixtures/agents/{name}", env!("CARGO_MANIFEST_DIR"));
        std::fs::read(&path).unwrap_or_else(|e| panic!("{path}: {e}"))
    }

    fn states(name: &str) -> Vec<(String, UiState)> {
        parse(&fixture(name)).unwrap().into_iter().map(|s| (s.key, s.state)).collect()
    }

    #[test]
    fn item7_every_ui_state_maps() {
        use UiState::*;
        assert_eq!(
            states("all-states.json"),
            [
                ("a1working".into(), Working),
                ("a2blocked".into(), NeedsYou),
                ("a3done".into(), Done),
                ("a4failed".into(), Failed),
                ("a5stopped".into(), Stopped),
                ("a6idle".into(), Paused),
                ("a7nolive".into(), Paused),
                ("11111111-2222-3333-4444-555555555555".into(), TerminalTab),
                ("pid:4242".into(), TerminalTab),
            ]
        );
    }

    #[test]
    fn item7_blocked_keeps_waiting_for() {
        let s = parse(&fixture("all-states.json")).unwrap();
        assert_eq!(s[1].waiting_for.as_deref(), Some("approve Bash"));
        assert_eq!(s[1].id.as_deref(), Some("a2blocked"));
        assert_eq!(s[7].id, None);
    }

    #[test]
    fn item7_unknown_null_and_missing_fields_do_not_panic() {
        use UiState::*;
        let s = parse(&fixture("odd.json")).unwrap();
        let got: Vec<_> =
            s.iter().map(|s| (s.key.as_str(), s.state, s.raw_state.as_deref())).collect();
        assert_eq!(
            got,
            [
                ("b1future", Unknown, Some("hibernating")),
                ("b2null", Unknown, None),
                ("b3bare", Unknown, None),
                ("/tmp/r@0", TerminalTab, None),
            ]
        );
        assert_eq!(s[2].cwd, "");
        assert_eq!(s[2].started_at, 0);
    }

    #[test]
    fn item8_bad_entry_is_skipped_not_fatal() {
        let keys: Vec<_> =
            parse(&fixture("bad-entry.json")).unwrap().into_iter().map(|s| s.key).collect();
        assert_eq!(keys, ["c1good", "c3good"]);
    }

    #[test]
    fn item8_non_array_is_an_error() {
        assert!(parse(&fixture("garbage.txt")).is_err());
        assert!(parse(br#"{"id":"x"}"#).is_err());
    }

    #[test]
    fn serializes_for_the_frontend() {
        let s = &parse(&fixture("all-states.json")).unwrap()[1];
        let v = serde_json::to_value(s).unwrap();
        assert_eq!(v["state"], "needs-you");
        assert_eq!(v["waitingFor"], "approve Bash");
        assert_eq!(v["rawState"], "blocked");
    }
}
