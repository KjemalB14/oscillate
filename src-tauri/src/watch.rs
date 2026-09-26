//! The "re-poll now" trigger: a file-watch on `~/.claude/sessions` and `~/.claude/jobs`.
//!
//! Invariant 5: nothing here reads a file. Only an event's path is looked at, to ignore
//! the churn of job logs (`timeline.jsonl`, `tmp/`) while a session streams. What counts
//! is a session file (`sessions/*.json`) or a job's `state.json` changing.

use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};

/// Watches `dirs` until the returned watcher is dropped. A directory that doesn't exist
/// is skipped with one log line; the timed poll still covers it.
pub fn watch(dirs: &[PathBuf], triggers: Sender<()>) -> Option<RecommendedWatcher> {
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<Event>| {
        // An error or a rescan may hide a change, so it re-polls too.
        let relevant = match &event {
            Ok(e) => e.need_rescan() || e.paths.is_empty() || e.paths.iter().any(|p| matters(p)),
            Err(_) => true,
        };
        if relevant {
            let _ = triggers.send(());
        }
    })
    .map_err(|e| eprintln!("oscillate: no file-watch, polling only: {e}"))
    .ok()?;
    for dir in dirs {
        if let Err(e) = watcher.watch(dir, RecursiveMode::Recursive) {
            eprintln!("oscillate: not watching {}: {e}", dir.display());
        }
    }
    Some(watcher)
}

fn matters(path: &Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let parent = path.parent().and_then(|p| p.file_name()).and_then(|n| n.to_str());
    name == "state.json" || (parent == Some("sessions") && name.ends_with(".json"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::poll::{PollConfig, Poller};
    use crate::testutil::{fixture, serial, FakeClaude};
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    #[test]
    fn only_session_and_state_files_matter() {
        assert!(matters(Path::new("/h/.claude/sessions/83804.json")));
        assert!(matters(Path::new("/h/.claude/jobs/ade5c70a/state.json")));
        assert!(!matters(Path::new("/h/.claude/jobs/ade5c70a/timeline.jsonl")));
        assert!(!matters(Path::new("/h/.claude/jobs/ade5c70a/tmp/x.json")));
        assert!(!matters(Path::new("/h/.claude/sessions/83804.6e49f2.key")));
        assert!(!matters(Path::new("/h/.claude/jobs/pins.json")));
    }

    /// Item 5, against a temp `sessions/` dir and a fake `claude` with a timed poll far
    /// enough away that every poll seen here was triggered.
    fn setup() -> (FakeClaude, tempfile::TempDir, PathBuf, RecommendedWatcher, Poller) {
        let fake = FakeClaude::new(&fixture("all-states.json"));
        let home = tempfile::tempdir().unwrap();
        let sessions = home.path().join("sessions");
        std::fs::create_dir(&sessions).unwrap();
        let (tx, rx) = mpsc::channel();
        let watcher = watch(&[sessions.clone(), home.path().join("missing")], tx).unwrap();
        let cfg = PollConfig { interval: Duration::from_secs(60), ..Default::default() };
        let poller = Poller::start(fake.resolver(), cfg, rx, |_| {});
        fake.wait_for_starts(1, Duration::from_secs(2)).unwrap();
        // Let FSEvents deliver anything left over from creating the dir.
        std::thread::sleep(Duration::from_millis(500));
        (fake, home, sessions, watcher, poller)
    }

    #[test]
    fn item5_a_touch_repolls_within_300ms() {
        let _serial = serial();
        let (fake, _home, sessions, _w, _p) = setup();
        let n = fake.starts();
        let touched = Instant::now();
        std::fs::write(sessions.join("4242.json"), "{}").unwrap();
        let seen = fake.wait_for_starts(n + 1, Duration::from_secs(2)).expect("no re-poll");
        let latency = seen - touched;
        assert!(latency <= Duration::from_millis(300), "re-polled after {latency:?}");
    }

    #[test]
    fn item5_a_burst_is_at_most_two_polls() {
        let _serial = serial();
        let (fake, _home, sessions, _w, _p) = setup();
        let n = fake.starts();
        for i in 0..20 {
            std::fs::write(sessions.join(format!("{i}.json")), "{}").unwrap();
        }
        std::thread::sleep(Duration::from_millis(1500));
        let polls = fake.starts() - n;
        assert!((1..=2).contains(&polls), "{polls} polls");
    }

    #[test]
    fn item5_log_churn_does_not_repoll() {
        let _serial = serial();
        let (fake, _home, sessions, _w, _p) = setup();
        let n = fake.starts();
        for i in 0..20 {
            std::fs::write(sessions.join(format!("{i}.jsonl")), "{}").unwrap();
        }
        std::thread::sleep(Duration::from_millis(1000));
        assert_eq!(fake.starts(), n);
    }
}
