//! The one poll of `claude agents --json --all` (invariant 2).
//!
//! A single thread runs every poll, so two are never in flight. It polls every 2s, and
//! at once (after a 100ms settle) when the file-watch sends a trigger. `on_change` is
//! called only when the mapped list differs from the last good one. A failed poll keeps
//! that list, logs one line, and waits 10s before the next timed try, so a missing
//! `claude` doesn't mean a login shell every 2s.

use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::claude::{child_env, Resolver};
use crate::sessions::{parse, Session};

pub struct PollConfig {
    pub interval: Duration,
    pub retry: Duration,
    pub settle: Duration,
    pub timeout: Duration,
}

impl Default for PollConfig {
    fn default() -> Self {
        PollConfig {
            interval: Duration::from_secs(2),
            retry: Duration::from_secs(10),
            settle: Duration::from_millis(100),
            timeout: Duration::from_secs(10),
        }
    }
}

/// Stops its thread when dropped.
pub struct Poller {
    latest: Arc<Mutex<Option<Vec<Session>>>>,
    stop: Arc<AtomicBool>,
}

impl Poller {
    pub fn start(
        resolver: Arc<Resolver>,
        cfg: PollConfig,
        triggers: Receiver<()>,
        on_change: impl Fn(&[Session]) + Send + 'static,
    ) -> Poller {
        let latest = Arc::new(Mutex::new(None));
        let stop = Arc::new(AtomicBool::new(false));
        let (latest2, stop2) = (latest.clone(), stop.clone());
        thread::Builder::new()
            .name("sessions-poll".into())
            .spawn(move || {
                let mut last: Option<Vec<Session>> = None;
                let mut due = Instant::now();
                while !stop2.load(Ordering::Relaxed) {
                    let wait = due.saturating_duration_since(Instant::now());
                    match triggers.recv_timeout(wait) {
                        Ok(()) => {
                            // A burst of file events becomes one poll.
                            thread::sleep(cfg.settle);
                            while triggers.try_recv().is_ok() {}
                        }
                        Err(RecvTimeoutError::Timeout) => {}
                        // No watcher: the timed poll still runs.
                        Err(RecvTimeoutError::Disconnected) => thread::sleep(wait),
                    }
                    if stop2.load(Ordering::Relaxed) {
                        break;
                    }
                    let started = Instant::now();
                    match poll_once(&resolver, cfg.timeout) {
                        Ok(sessions) => {
                            due = started + cfg.interval;
                            if last.as_ref() != Some(&sessions) {
                                *latest2.lock().unwrap() = Some(sessions.clone());
                                on_change(&sessions);
                                last = Some(sessions);
                            }
                        }
                        Err(e) => {
                            eprintln!("oscillate: sessions poll failed: {e}");
                            due = started + cfg.retry;
                        }
                    }
                }
            })
            .expect("spawn the sessions poll");
        Poller { latest, stop }
    }

    /// The last good list, for a page that loads after the event fired. `None` until the
    /// first good poll, so a page can tell "not known yet" from "no sessions".
    pub fn snapshot(&self) -> Option<Vec<Session>> {
        self.latest.lock().unwrap().clone()
    }
}

impl Drop for Poller {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

fn poll_once(resolver: &Resolver, timeout: Duration) -> Result<Vec<Session>, String> {
    let claude = resolver.get()?;
    let mut child = Command::new(&claude.path)
        .args(["agents", "--json", "--all"])
        .env_clear()
        .envs(child_env(&claude))
        .current_dir(std::env::var_os("HOME").unwrap_or_else(|| "/".into()))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("couldn't run {}: {e}", claude.path.display()))?;
    let mut stdout = child.stdout.take().unwrap();
    let reader = thread::spawn(move || {
        let mut out = Vec::new();
        stdout.read_to_end(&mut out).map(|_| out)
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => break status,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("no answer in {timeout:?}"));
            }
            None => thread::sleep(Duration::from_millis(10)),
        }
    };
    let out = reader.join().unwrap().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!("exited with {status}"));
    }
    parse(&out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{fixture, serial, FakeClaude};
    use std::sync::mpsc::{self, Sender};

    struct Seen(Arc<Mutex<Vec<Vec<Session>>>>);

    impl Seen {
        fn count(&self) -> usize {
            self.0.lock().unwrap().len()
        }
    }

    fn start(fake: &FakeClaude, cfg: PollConfig) -> (Poller, Sender<()>, Seen) {
        let (tx, rx) = mpsc::channel();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let s = seen.clone();
        let record = move |list: &[Session]| s.lock().unwrap().push(list.to_vec());
        let poller = Poller::start(fake.resolver(), cfg, rx, record);
        (poller, tx, Seen(seen))
    }

    fn fast(interval_ms: u64) -> PollConfig {
        PollConfig {
            interval: Duration::from_millis(interval_ms),
            retry: Duration::from_millis(interval_ms),
            ..Default::default()
        }
    }

    const SECOND: Duration = Duration::from_secs(1);

    #[test]
    fn item4_polls_never_overlap() {
        let _serial = serial();
        let fake = FakeClaude::new(&fixture("all-states.json"));
        fake.set_delay(3.0);
        let (_poller, tx, _) = start(&fake, PollConfig::default());
        for _ in 0..40 {
            let _ = tx.send(());
            thread::sleep(Duration::from_millis(200));
        }
        // 8s of triggers against a 3s poll: two or three polls, one at a time.
        let log = fake.log();
        assert!(!log.contains(&"overlap".to_string()), "{log:?}");
        assert!((2..=3).contains(&fake.starts()), "{log:?}");
    }

    #[test]
    fn item4_timed_poll_every_2s() {
        let _serial = serial();
        let fake = FakeClaude::new(&fixture("all-states.json"));
        let (_poller, _tx, _) = start(&fake, PollConfig::default());
        // The first run of a freshly written fake reaches its log ~200ms late (measured:
        // first gap 1.80s, then 2.00 ± 0.02s), so the schedule is measured from poll 2.
        let t: Vec<Instant> =
            (2..=5).map(|n| fake.wait_for_starts(n, 3 * SECOND).expect("poll")).collect();
        for gap in t.windows(2).map(|w| w[1] - w[0]) {
            assert!(
                gap >= Duration::from_millis(1800) && gap <= Duration::from_millis(2200),
                "gap {gap:?}"
            );
        }
    }

    #[test]
    fn item6_identical_polls_emit_once() {
        let _serial = serial();
        let fake = FakeClaude::new(&fixture("all-states.json"));
        let (_poller, _tx, seen) = start(&fake, fast(100));
        fake.wait_for_starts(4, 5 * SECOND).unwrap();
        assert_eq!(seen.count(), 1);

        let changed = String::from_utf8(fixture("all-states.json"))
            .unwrap()
            .replace(r#""status": "idle""#, r#""status": "busy""#);
        fake.set_out(changed.as_bytes());
        let n = fake.starts();
        fake.wait_for_starts(n + 3, 5 * SECOND).unwrap();
        assert_eq!(seen.count(), 2);
        let last = seen.0.lock().unwrap()[1].clone();
        assert_eq!(last[5].state, crate::sessions::UiState::Working);
    }

    #[test]
    fn item8_failed_polls_keep_the_last_list() {
        let _serial = serial();
        let fake = FakeClaude::new(&fixture("all-states.json"));
        let (poller, _tx, seen) = start(&fake, fast(100));
        fake.wait_for_starts(1, 5 * SECOND).unwrap();
        thread::sleep(Duration::from_millis(50));
        assert_eq!(seen.count(), 1);
        let good = poller.snapshot();

        fake.set_exit(1);
        let n = fake.starts();
        fake.wait_for_starts(n + 2, 5 * SECOND).unwrap();
        fake.set_exit(0);
        fake.set_out(&fixture("garbage.txt"));
        let n = fake.starts();
        fake.wait_for_starts(n + 2, 5 * SECOND).unwrap();
        assert_eq!(seen.count(), 1);
        assert_eq!(poller.snapshot(), good);

        // Recovery: a different good list is emitted.
        fake.set_out(&fixture("bad-entry.json"));
        let n = fake.starts();
        fake.wait_for_starts(n + 2, 5 * SECOND).unwrap();
        thread::sleep(Duration::from_millis(50));
        assert_eq!(seen.count(), 2);
    }

    #[test]
    fn snapshot_is_none_until_the_first_good_poll() {
        let _serial = serial();
        let fake = FakeClaude::new(b"[]");
        fake.set_delay(0.5);
        let (poller, _tx, seen) = start(&fake, fast(100));
        assert_eq!(poller.snapshot(), None);
        fake.wait_for_starts(2, 5 * SECOND).unwrap();
        assert_eq!(seen.count(), 1);
        assert_eq!(poller.snapshot(), Some(vec![]));
    }

    #[test]
    fn a_failed_poll_waits_the_retry_interval() {
        let _serial = serial();
        let fake = FakeClaude::new(b"[]");
        fake.set_exit(1);
        let cfg = PollConfig {
            interval: Duration::from_millis(100),
            retry: 2 * SECOND,
            ..Default::default()
        };
        let (_poller, tx, _) = start(&fake, cfg);
        fake.wait_for_starts(1, SECOND).unwrap();
        thread::sleep(Duration::from_millis(800));
        assert_eq!(fake.starts(), 1, "retried before the retry interval");
        // A trigger still polls at once.
        tx.send(()).unwrap();
        assert!(fake.wait_for_starts(2, Duration::from_millis(500)).is_some());
    }

    #[test]
    fn a_hung_claude_times_out() {
        let fake = FakeClaude::new(b"[]");
        fake.set_delay(30.0);
        let resolver = fake.resolver();
        let started = Instant::now();
        let err = poll_once(&resolver, Duration::from_millis(300)).unwrap_err();
        assert!(err.contains("no answer"), "{err}");
        assert!(started.elapsed() < SECOND);
    }
}
