//! Stop and Remove, from a row's context menu: `claude stop <id>` and `claude rm <id>`,
//! through the resolver (invariant 4). The daemon does the stopping and removing
//! (invariant 1). Each runs only once the app's own attach to that session has been
//! reaped (`pty::end_attaches`; PLAN-new-sessions.md, *Stop and Remove*).
//!
//! What Claude Code 2.1.285 printed is in `fixtures/end/`:
//! - `stop` prints `stopped <id>` and exits 0. A session that was live is then listed as
//!   `stopped`, and one already `done` stays `done`.
//! - `rm` prints `removed <id>` and exits 0. It **refuses** a session whose worktree holds
//!   commits that are on no remote: it exits 1 and says so on **stdout**, ending with the
//!   `--discard-unpushed` command that would discard them. That text is shown verbatim.
//!
//! The argv is exactly `stop <id>` or `rm <id>`. The app never passes `--discard-unpushed`
//! or `--force-remove-worktree`, and offers nothing that would.

use std::time::Duration;

use serde::Deserialize;

use crate::claude::{run_once, Resolver};

/// Which of the two a row's menu asked for.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum End {
    Stop,
    Remove,
}

/// Both return once the daemon has acted; this only catches a hang.
const TIMEOUT: Duration = Duration::from_secs(30);

/// The argv after `claude`: `stop <id>` or `rm <id>`, and nothing else.
pub fn args(end: End, id: &str) -> Result<Vec<String>, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(format!("not a session id: {id:?}"));
    }
    let verb = match end {
        End::Stop => "stop",
        End::Remove => "rm",
    };
    Ok(vec![verb.to_string(), id.to_string()])
}

/// Runs `claude stop|rm <id>` in `cwd`. A non-zero exit returns what it printed,
/// verbatim: stderr, then stdout.
pub fn run(resolver: &Resolver, end: End, id: &str, cwd: &str) -> Result<(), String> {
    let ran = run_once(resolver, &args(end, id)?, cwd, TIMEOUT)?;
    if ran.status.success() {
        Ok(())
    } else {
        Err(ran.shown())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argv_is_the_verb_and_the_id_only() {
        assert_eq!(args(End::Stop, "a5546f19").unwrap(), ["stop", "a5546f19"]);
        assert_eq!(args(End::Remove, "a5546f19").unwrap(), ["rm", "a5546f19"]);
        assert!(args(End::Remove, "").is_err());
        assert!(args(End::Remove, "a5 --discard-unpushed").is_err());
        assert!(args(End::Stop, "../x").is_err());
    }

    #[test]
    fn the_menu_names_deserialize() {
        assert_eq!(serde_json::from_str::<End>("\"stop\"").unwrap(), End::Stop);
        assert_eq!(serde_json::from_str::<End>("\"remove\"").unwrap(), End::Remove);
        assert!(serde_json::from_str::<End>("\"rm\"").is_err());
    }
}
