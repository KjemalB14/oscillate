//! The "+" prompt box's one action: `claude --bg [--permission-mode <m>] <prompt>` in a
//! group's `cwd`, through the resolver (invariant 4), as argv with no shell. The daemon
//! owns the session from there (invariant 1); the app only reads the id it prints.
//!
//! `--bg` prints the id in its first line, `backgrounded · <id>`, colored even into a
//! pipe, then hint lines such as `claude attach <id>`. The bytes Claude Code 2.1.284
//! printed are in `fixtures/bg/` (PLAN-new-sessions.md, *Still open*; NOTES.md,
//! *Chapter 3, slice 2*).
//!
//! In a folder that isn't trusted yet, `--bg` starts nothing: it exits 1 with empty
//! stdout and one line on stderr, `Workspace not trusted. Run \`claude\` in <dir> once
//! and accept the trust prompt, then retry.` (`fixtures/bg/untrusted-2.1.284.txt`). That
//! error is the only trust signal the app reads; it never looks at the trust flag.

use std::path::Path;
use std::time::Duration;

use serde::Serialize;

use crate::claude::{run_once, Resolver};

/// What `--bg` says when the folder isn't trusted; the start of its stderr.
const UNTRUSTED: &str = "Workspace not trusted";

/// Why a start failed: the text to show verbatim, and whether it was the trust error,
/// which opens the trust pane instead.
#[derive(Debug, PartialEq, Serialize)]
pub struct StartError {
    pub untrusted: bool,
    pub message: String,
}

impl From<String> for StartError {
    fn from(message: String) -> Self {
        StartError { untrusted: false, message }
    }
}

impl From<&str> for StartError {
    fn from(message: &str) -> Self {
        message.to_string().into()
    }
}

/// The modes the box offers; `None` is Default, which passes no flag.
/// `bypassPermissions` is left out on purpose (PLAN-new-sessions.md).
pub const MODES: &[&str] = &["plan", "acceptEdits", "auto", "manual", "dontAsk"];

/// `--bg` returns once the daemon has the session; this only catches a hang.
const TIMEOUT: Duration = Duration::from_secs(30);

/// The argv after `claude`, byte-exact: the prompt is one argument, never parsed.
pub fn bg_args(mode: Option<&str>, prompt: &str) -> Result<Vec<String>, String> {
    if prompt.trim().is_empty() {
        return Err("The prompt is empty.".into());
    }
    let mut args = vec!["--bg".to_string()];
    if let Some(mode) = mode {
        if !MODES.contains(&mode) {
            return Err(format!("not a permission mode the app offers: {mode:?}"));
        }
        args.extend(["--permission-mode".to_string(), mode.to_string()]);
    }
    args.push(prompt.to_string());
    Ok(args)
}

/// The id from `--bg`'s stdout: the word after the first line's `·`, else the one after
/// `claude attach`. Only an id the attach will take (letters and digits) counts.
pub fn parse_id(stdout: &str) -> Option<String> {
    let plain = strip_ansi(stdout);
    let is_id = |w: &str| !w.is_empty() && w.chars().all(|c| c.is_ascii_alphanumeric());
    let after_dot = plain.lines().find_map(|l| l.rsplit_once('·')).map(|(_, rest)| rest.trim());
    if let Some(id) = after_dot.filter(|w| is_id(w)) {
        return Some(id.to_string());
    }
    plain.lines().find_map(|l| {
        let mut words = l.split_whitespace();
        while let Some(w) = words.next() {
            if w == "attach" {
                return words.next().filter(|w| is_id(w)).map(String::from);
            }
        }
        None
    })
}

/// Drops CSI sequences (`ESC [ ... letter`), which is all `--bg` colors with.
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' && chars.peek() == Some(&'[') {
            chars.next();
            for c in chars.by_ref() {
                if c.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Whether `--bg`'s stderr is the trust error.
fn is_untrusted(stderr: &str) -> bool {
    stderr.trim_start().starts_with(UNTRUSTED)
}

/// Runs `--bg` and returns the new session's id, or the text to show verbatim: stderr,
/// then stdout.
pub fn start(resolver: &Resolver, cwd: &str, mode: Option<&str>, prompt: &str) -> Result<String, StartError> {
    let args = bg_args(mode, prompt)?;
    if !Path::new(cwd).is_dir() {
        return Err(format!("{cwd} no longer exists.").into());
    }
    let ran = run_once(resolver, &args, cwd, TIMEOUT)?;
    if !ran.status.success() {
        return Err(StartError { untrusted: is_untrusted(&ran.stderr), message: ran.shown() });
    }
    parse_id(&ran.stdout)
        .ok_or_else(|| format!("`claude --bg` printed no session id:\n{}{}", ran.stdout, ran.stderr).into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::claude::ClaudeBin;
    use crate::pty::BASE_PATH;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::Arc;

    fn captured() -> String {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/bg/2.1.284.txt");
        std::fs::read_to_string(path).unwrap()
    }

    #[test]
    fn the_id_is_read_from_real_output() {
        assert_eq!(parse_id(&captured()).as_deref(), Some("c59cf1b2"));
    }

    #[test]
    fn the_attach_hint_is_the_fallback() {
        assert_eq!(parse_id("started\n  claude attach ab12cd34   open\n").as_deref(), Some("ab12cd34"));
        assert_eq!(parse_id("nothing here\n"), None);
        assert_eq!(parse_id("backgrounded · ../etc\n"), None);
    }

    #[test]
    fn argv_is_the_prompt_unparsed() {
        let prompt = "say \"hi\" $HOME `x`\nline two '";
        assert_eq!(bg_args(None, prompt).unwrap(), ["--bg", prompt]);
        assert_eq!(bg_args(Some("plan"), prompt).unwrap(), ["--bg", "--permission-mode", "plan", prompt]);
        assert!(bg_args(Some("bypassPermissions"), prompt).is_err());
        assert!(bg_args(None, " \n ").is_err());
    }

    /// A fake that writes its argv (NUL-separated) and cwd, then answers as told.
    fn fake(script_tail: &str) -> (tempfile::TempDir, Arc<Resolver>) {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path().to_str().unwrap().to_string();
        let bin = dir.path().join("claude");
        std::fs::write(
            &bin,
            format!("#!/bin/sh\nprintf '%s\\0' \"$@\" > '{d}/argv'\npwd -P > '{d}/cwd'\n{script_tail}\n"),
        )
        .unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        let resolver =
            Arc::new(Resolver::new(move || Ok(ClaudeBin { path: bin.clone(), path_var: BASE_PATH.into() })));
        (dir, resolver)
    }

    #[test]
    fn start_runs_in_cwd_with_exact_argv() {
        let (dir, resolver) = fake("printf 'backgrounded \\302\\267 \\033[36mab12\\033[39m\\n'");
        let repo = tempfile::tempdir().unwrap();
        let prompt = "a \"q\" $X `y`\nz";
        let id = start(&resolver, repo.path().to_str().unwrap(), Some("plan"), prompt).unwrap();
        assert_eq!(id, "ab12");
        let argv = std::fs::read(dir.path().join("argv")).unwrap();
        let want: Vec<u8> = ["--bg", "--permission-mode", "plan", prompt].iter().flat_map(|a| [a.as_bytes(), b"\0"].concat()).collect();
        assert_eq!(argv, want);
        let cwd = std::fs::read_to_string(dir.path().join("cwd")).unwrap();
        assert_eq!(cwd.trim(), repo.path().canonicalize().unwrap().to_str().unwrap());
    }

    #[test]
    fn a_failure_shows_stderr_then_stdout() {
        let (_dir, resolver) = fake("echo out; echo 'Workspace not trusted' >&2; exit 3");
        let repo = tempfile::tempdir().unwrap();
        let err = start(&resolver, repo.path().to_str().unwrap(), None, "p").unwrap_err();
        assert_eq!(err, StartError { untrusted: true, message: "Workspace not trusted\nout\n".into() });
        let (_dir, resolver) = fake("echo 'no such mode' >&2; exit 2");
        let err = start(&resolver, repo.path().to_str().unwrap(), None, "p").unwrap_err();
        assert_eq!(err, StartError { untrusted: false, message: "no such mode\n".into() });
    }

    #[test]
    fn the_real_trust_error_is_told_apart() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/bg/untrusted-2.1.284.txt");
        assert!(is_untrusted(&std::fs::read_to_string(path).unwrap()));
        assert!(!is_untrusted("error: unknown option '--permission-mode'\n"));
    }
}
