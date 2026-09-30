//! The one place that decides which `claude` to run (invariant 4).
//!
//! `OSCILLATE_CLAUDE_BIN` wins, so tests can point at a fake `claude` and never touch
//! real sessions or usage. Otherwise the user's interactive login shell is asked, because
//! that is where `claude` is on their PATH: an nvm install is only set up in `.zshrc`, so
//! `$SHELL -lc` alone doesn't find it (NOTES.md, chapter 1 slice 2).
//!
//! Asking the shell costs ~1s, so the answer is cached for the app's lifetime, warmed on
//! a background thread at launch, and looked up again once if the cached binary is gone
//! (an nvm switch or a reinstall). NOTES.md, *Chapter 2 closed*, has the reasoning.

use std::ffi::OsString;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use crate::pty::{clean_env, BASE_PATH};

#[derive(Debug)]
pub struct ClaudeBin {
    pub path: PathBuf,
    /// The login shell's PATH. `claude attach` may start the supervisor daemon, which
    /// passes its PATH on to every background session, so outside tests it must not be
    /// the bare base.
    pub path_var: OsString,
}

type Lookup = Box<dyn Fn() -> Result<ClaudeBin, String> + Send + Sync>;

pub struct Resolver {
    lookup: Lookup,
    cache: Mutex<Option<Arc<ClaudeBin>>>,
    lookups: AtomicU32,
}

impl Resolver {
    pub fn new(lookup: impl Fn() -> Result<ClaudeBin, String> + Send + Sync + 'static) -> Self {
        Resolver { lookup: Box::new(lookup), cache: Mutex::new(None), lookups: AtomicU32::new(0) }
    }

    /// The cached `claude`, looked up on first use or when the cached path has vanished.
    /// The lock is held across the lookup, so callers that arrive during it wait for that
    /// one shell instead of starting their own. Errors are not cached.
    pub fn get(&self) -> Result<Arc<ClaudeBin>, String> {
        let mut cache = self.cache.lock().unwrap();
        if let Some(bin) = &*cache {
            // A stat per call is microseconds; it catches an uninstalled node version.
            if bin.path.exists() {
                return Ok(bin.clone());
            }
            *cache = None;
        }
        self.lookups.fetch_add(1, Ordering::Relaxed);
        let bin = Arc::new((self.lookup)()?);
        *cache = Some(bin.clone());
        Ok(bin)
    }

    /// Starts the lookup on a background thread, so the window never waits on it.
    pub fn warm(self: Arc<Self>) {
        thread::spawn(move || {
            if let Err(e) = self.get() {
                eprintln!("oscillate: {e}");
            }
        });
    }

    #[cfg(test)]
    pub fn lookup_count(&self) -> u32 {
        self.lookups.load(Ordering::Relaxed)
    }
}

/// The app's one resolver.
pub fn resolver() -> Arc<Resolver> {
    static RESOLVER: OnceLock<Arc<Resolver>> = OnceLock::new();
    RESOLVER.get_or_init(|| Arc::new(Resolver::new(login_shell_lookup))).clone()
}

/// The environment a `claude` child runs with: the allowlist plus the login shell's PATH.
pub fn child_env(bin: &ClaudeBin) -> Vec<(OsString, OsString)> {
    let mut env = clean_env();
    env.retain(|(key, _)| key != "PATH");
    env.push(("PATH".into(), bin.path_var.clone()));
    env
}

/// What a one-shot `claude` printed, and how it exited.
pub struct Ran {
    /// `claude`'s first argument, for a failure that printed nothing.
    cmd: String,
    pub status: ExitStatus,
    pub stdout: String,
    pub stderr: String,
}

impl Ran {
    /// A failure as shown verbatim: stderr, then stdout. `rm` refuses on stdout alone.
    pub fn shown(&self) -> String {
        let mut shown = if self.stderr.trim().is_empty() { String::new() } else { self.stderr.clone() };
        if !self.stdout.trim().is_empty() {
            if !shown.is_empty() && !shown.ends_with('\n') {
                shown.push('\n');
            }
            shown.push_str(&self.stdout);
        }
        if shown.is_empty() {
            format!("`claude {}` {}", self.cmd, self.status)
        } else {
            shown
        }
    }
}

/// Runs `claude <args>` in `cwd` through `resolver` (invariant 4): argv with no shell,
/// stdin closed, the clean environment. A child still running after `timeout` is killed,
/// and that is an error.
pub fn run_once(resolver: &Resolver, args: &[String], cwd: &str, timeout: Duration) -> Result<Ran, String> {
    let cmd = args.first().cloned().unwrap_or_default();
    let claude = resolver.get()?;
    let mut child = Command::new(&claude.path)
        .args(args)
        .env_clear()
        .envs(child_env(&claude))
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("couldn't run {}: {e}", claude.path.display()))?;
    let read_all = |mut r: Box<dyn Read + Send>| {
        thread::spawn(move || {
            let mut out = Vec::new();
            let _ = r.read_to_end(&mut out);
            String::from_utf8_lossy(&out).into_owned()
        })
    };
    let stdout = read_all(Box::new(child.stdout.take().unwrap()));
    let stderr = read_all(Box::new(child.stderr.take().unwrap()));
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => break status,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("`claude {cmd}` didn't answer in {}s.", timeout.as_secs()));
            }
            None => thread::sleep(Duration::from_millis(20)),
        }
    };
    let (stdout, stderr) = (stdout.join().unwrap(), stderr.join().unwrap());
    Ok(Ran { cmd, status, stdout, stderr })
}

fn login_shell_lookup() -> Result<ClaudeBin, String> {
    if let Some(path) = std::env::var_os("OSCILLATE_CLAUDE_BIN") {
        // Not the app's own PATH: a dev launch would leak npm's into the child.
        return Ok(ClaudeBin { path: path.into(), path_var: BASE_PATH.into() });
    }

    let shell = std::env::var_os("SHELL").unwrap_or_else(|| "/bin/zsh".into());
    // Two lines on stdout: where `claude` is, then PATH. An interactive shell's rc files
    // may print too, so only the last two lines count.
    let out = Command::new(&shell)
        .args(["-lic", r#"command -v claude; printf '%s\n' "$PATH""#])
        .env_clear()
        .envs(clean_env())
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .map_err(|e| format!("couldn't run {}: {e}", shell.to_string_lossy()))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let lines: Vec<&str> = stdout.lines().filter(|l| !l.is_empty()).collect();
    match lines[..] {
        [.., claude, path_var] if claude.starts_with('/') => {
            Ok(ClaudeBin { path: claude.into(), path_var: path_var.into() })
        }
        _ => Err(format!(
            "`claude` not found on the login shell's PATH; set OSCILLATE_CLAUDE_BIN \
             (got {stdout:?})"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn counting(path: PathBuf, delay: Duration) -> Arc<Resolver> {
        Arc::new(Resolver::new(move || {
            thread::sleep(delay);
            Ok(ClaudeBin { path: path.clone(), path_var: BASE_PATH.into() })
        }))
    }

    #[test]
    fn item1_one_lookup_for_many_calls() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("claude");
        std::fs::write(&bin, "").unwrap();
        let r = counting(bin, Duration::ZERO);
        for _ in 0..100 {
            r.get().unwrap();
        }
        assert_eq!(r.lookup_count(), 1);
    }

    #[test]
    fn item1_concurrent_first_callers_share_one_lookup() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("claude");
        std::fs::write(&bin, "").unwrap();
        let r = counting(bin, Duration::from_millis(200));
        let threads: Vec<_> = (0..8)
            .map(|_| {
                let r = r.clone();
                thread::spawn(move || r.get().unwrap())
            })
            .collect();
        for t in threads {
            t.join().unwrap();
        }
        assert_eq!(r.lookup_count(), 1);
    }

    #[test]
    fn item1_env_override_skips_the_shell() {
        // No other test reads OSCILLATE_CLAUDE_BIN or calls login_shell_lookup.
        std::env::set_var("OSCILLATE_CLAUDE_BIN", "/nonexistent/fake-claude");
        let started = Instant::now();
        let bin = login_shell_lookup().unwrap();
        std::env::remove_var("OSCILLATE_CLAUDE_BIN");
        assert_eq!(bin.path, PathBuf::from("/nonexistent/fake-claude"));
        assert_eq!(bin.path_var, OsString::from(BASE_PATH));
        assert!(started.elapsed() < Duration::from_millis(50), "a shell ran");
    }

    #[test]
    fn item2_vanished_binary_is_looked_up_once_more() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("claude");
        std::fs::write(&bin, "").unwrap();
        let r = counting(bin.clone(), Duration::ZERO);
        r.get().unwrap();
        std::fs::remove_file(&bin).unwrap();
        // The lookup still returns the missing path: one more lookup, no loop.
        r.get().unwrap();
        assert_eq!(r.lookup_count(), 2);
        std::fs::write(&bin, "").unwrap();
        r.get().unwrap();
        assert_eq!(r.lookup_count(), 2);
    }

    #[test]
    fn item2_failed_lookup_is_not_cached() {
        let calls = Arc::new(AtomicU32::new(0));
        let c = calls.clone();
        let r = Resolver::new(move || {
            c.fetch_add(1, Ordering::Relaxed);
            Err("not found".into())
        });
        assert!(r.get().is_err());
        assert!(r.get().is_err());
        assert_eq!(calls.load(Ordering::Relaxed), 2);
    }

    #[test]
    fn a_refusal_on_stdout_alone_is_shown_verbatim() {
        use std::os::unix::process::ExitStatusExt;
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/end/rm-refused-2.1.285.txt");
        let refusal = std::fs::read_to_string(path).unwrap();
        let ran = |stdout: &str, stderr: &str| Ran {
            cmd: "rm".into(),
            status: ExitStatus::from_raw(1 << 8),
            stdout: stdout.into(),
            stderr: stderr.into(),
        };
        assert_eq!(ran(&refusal, "").shown(), refusal);
        assert_eq!(ran("out\n", "err").shown(), "err\nout\n");
        assert_eq!(ran("", " \n").shown(), "`claude rm` exit status: 1");
    }

    #[test]
    fn item3_warm_returns_at_once() {
        let r = counting("/bin/sh".into(), Duration::from_secs(3));
        let started = Instant::now();
        r.clone().warm();
        assert!(started.elapsed() < Duration::from_millis(50));
    }
}
