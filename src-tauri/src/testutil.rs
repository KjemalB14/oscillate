//! A fake `claude` for tests. Children run with a clean environment (`child_env`), so
//! the fake's behavior lives in files beside it that tests rewrite between polls.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use crate::claude::{ClaudeBin, Resolver};
use crate::pty::BASE_PATH;

pub struct FakeClaude {
    pub dir: tempfile::TempDir,
}

impl FakeClaude {
    /// Answers `agents --json --all` with the contents of `out` after `delay` seconds,
    /// exiting with `exit`. Each run appends "start" to `log`, and "overlap" first if
    /// another run is still going.
    pub fn new(out: &[u8]) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path().to_str().unwrap().replace('\'', r"'\''");
        let script = format!(
            r#"#!/bin/sh
d='{d}'
[ "$*" = "agents --json --all" ] || {{ echo "unexpected: $*" >> "$d/log"; exit 2; }}
mkdir "$d/lock" 2>/dev/null || echo overlap >> "$d/log"
echo start >> "$d/log"
sleep "$(cat "$d/delay")"
cat "$d/out"
rmdir "$d/lock" 2>/dev/null
exit "$(cat "$d/exit")"
"#
        );
        let bin = dir.path().join("claude");
        std::fs::write(&bin, script).unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        let fake = FakeClaude { dir };
        fake.set_out(out);
        fake.set_delay(0.0);
        fake.set_exit(0);
        std::fs::write(fake.path("log"), "").unwrap();
        fake
    }

    pub fn path(&self, name: &str) -> PathBuf {
        self.dir.path().join(name)
    }

    pub fn set_out(&self, out: &[u8]) {
        std::fs::write(self.path("out"), out).unwrap();
    }

    pub fn set_delay(&self, secs: f64) {
        std::fs::write(self.path("delay"), secs.to_string()).unwrap();
    }

    pub fn set_exit(&self, code: i32) {
        std::fs::write(self.path("exit"), code.to_string()).unwrap();
    }

    pub fn log(&self) -> Vec<String> {
        std::fs::read_to_string(self.path("log")).unwrap().lines().map(String::from).collect()
    }

    pub fn starts(&self) -> usize {
        self.log().iter().filter(|l| *l == "start").count()
    }

    /// Waits until the fake has started `n` times; returns when that was seen.
    pub fn wait_for_starts(&self, n: usize, timeout: Duration) -> Option<Instant> {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if self.starts() >= n {
                return Some(Instant::now());
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        None
    }

    /// A resolver that hands out this fake and never runs a shell.
    pub fn resolver(&self) -> Arc<Resolver> {
        let path = self.path("claude");
        Arc::new(Resolver::new(move || {
            Ok(ClaudeBin { path: path.clone(), path_var: BASE_PATH.into() })
        }))
    }
}

pub fn fixture(name: &str) -> Vec<u8> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/agents").join(name);
    std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// Tests that start a poller hold this, so their timings aren't skewed by the others'
/// process spawns.
pub fn serial() -> MutexGuard<'static, ()> {
    static LOCK: Mutex<()> = Mutex::new(());
    LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}
