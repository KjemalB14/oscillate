//! The one place that decides which `claude` to run (invariant 4).
//!
//! `OSCILLATE_CLAUDE_BIN` wins, so tests can point at a fake `claude` and never touch
//! real sessions or usage. Otherwise the user's interactive login shell is asked, because
//! that is where `claude` is on their PATH: an nvm install is only set up in `.zshrc`, so
//! `$SHELL -lc` alone doesn't find it (NOTES.md, chapter 1 slice 2).

use std::ffi::OsString;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use crate::pty::{clean_env, BASE_PATH};

pub struct ClaudeBin {
    pub path: PathBuf,
    /// The login shell's PATH. `claude attach` may start the supervisor daemon, which
    /// passes its PATH on to every background session, so outside tests it must not be
    /// the bare base.
    pub path_var: OsString,
}

pub fn claude_bin() -> Result<ClaudeBin, String> {
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
