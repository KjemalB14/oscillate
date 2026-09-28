//! PTYs owned by Rust, streamed to xterm.js over a Tauri `Channel`. Each runs
//! `claude attach <id>` for one session, in that session's own `cwd`.
//!
//! Output is sent as raw bytes. The reader thread pauses once `HIGH_WATER` bytes are in
//! flight to the webview, and resumes as xterm.js acks what it has parsed. That
//! backpressure reaches the child through the PTY, so a flood can't pile up in the
//! webview and Ctrl+C stays prompt (PLAN-terminal.md, item 7).
//!
//! Invariant 3 lives here: a session has at most one PTY, from its spawn until its child
//! has been reaped, not just until it was told to go. A watch thread detaches any child
//! that has stopped being `claude attach <id>`, because ← execs agent view in the same
//! pid (NOTES.md, chapter 2 slice 3), and agent view could attach this PTY to another
//! session.

use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, State};

use crate::claude::{child_env, resolver};
use crate::sessions::Session;

const READ_CHUNK: usize = 64 * 1024;
const MAX_MESSAGE: usize = 256 * 1024;
const HIGH_WATER: usize = 1024 * 1024;

/// How often the watch reads each child's argv. ← shows agent view within this, plus
/// the kill.
const WATCH_EVERY: Duration = Duration::from_millis(250);
/// A child still alive this long after its hangup gets SIGKILL.
const KILL_AFTER: Duration = Duration::from_secs(2);
/// How long a spawn waits for the same session's previous child to be reaped.
const SPAWN_WAIT: Duration = Duration::from_secs(3);

/// The only variables a PTY inherits from the app. Everything else comes from the login
/// shell's own profile, exactly as when the app is launched from Finder. Inheriting a dev
/// launcher's env leaked `EDITOR=vi` (zsh silently switches to vi keys), Ghostty's
/// `TERMINFO`, and `CLAUDE_CODE_*` session variables that `claude attach` would act on.
const INHERITED_VARS: &[&str] = &[
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "LANG",
    "SSH_AUTH_SOCK",
    "__CF_USER_TEXT_ENCODING",
];

/// launchd's default PATH; the login shell's profile (path_helper, nvm, ...) builds on it.
pub const BASE_PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";

/// The environment every child starts from: the allowlist plus the base PATH.
pub fn clean_env() -> Vec<(OsString, OsString)> {
    let mut env: Vec<(OsString, OsString)> = INHERITED_VARS
        .iter()
        .filter_map(|var| Some((var.into(), std::env::var_os(var)?)))
        .collect();
    env.push(("PATH".into(), BASE_PATH.into()));
    // A Finder-launched app has no LANG, and zsh then mis-measures wide characters.
    if std::env::var_os("LANG").is_none() {
        env.push(("LANG".into(), "en_US.UTF-8".into()));
    }
    env
}

#[derive(Default)]
pub struct Ptys {
    next_id: AtomicU32,
    live: Mutex<HashMap<u32, Pty>>,
    /// Signalled whenever a PTY leaves `live`.
    reaped: Condvar,
}

struct Pty {
    /// The session this PTY runs `claude attach` for.
    session: String,
    pid: Option<u32>,
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    flow: Arc<Flow>,
    /// When it was told to go. It stays in `live` until its child is reaped.
    closing: Option<Instant>,
    /// The watch has seen the child as `attach <id>`. Until then its argv may still be the
    /// app's own: the spawn can return before the fork has exec'd.
    armed: bool,
}

impl Pty {
    /// Hangs up the child, which for `claude attach` is a detach. Idempotent.
    fn close(&mut self) {
        if self.closing.is_some() {
            return;
        }
        self.closing = Some(Instant::now());
        self.flow.close();
        match self.pid {
            Some(pid) => signal(pid, libc::SIGHUP),
            None => {
                let _ = self.killer.kill();
            }
        }
    }
}

/// Bytes sent to the webview and not yet acked.
#[derive(Default)]
struct Flow {
    state: Mutex<FlowState>,
    cv: Condvar,
}

#[derive(Default)]
struct FlowState {
    in_flight: usize,
    closed: bool,
}

impl Flow {
    /// Blocks while too much is in flight. Returns false once the PTY is closed.
    fn wait_for_room(&self) -> bool {
        let mut s = self.state.lock().unwrap();
        while s.in_flight >= HIGH_WATER && !s.closed {
            s = self.cv.wait(s).unwrap();
        }
        !s.closed
    }

    fn sent(&self, n: usize) {
        self.state.lock().unwrap().in_flight += n;
    }

    fn acked(&self, n: usize) {
        let mut s = self.state.lock().unwrap();
        s.in_flight = s.in_flight.saturating_sub(n);
        self.cv.notify_all();
    }

    fn close(&self) {
        self.state.lock().unwrap().closed = true;
        self.cv.notify_all();
    }
}

/// Spawns `claude attach <session>` in the session's `cwd`, and returns the PTY's id.
#[tauri::command(async)]
pub fn pty_spawn(
    app: AppHandle,
    ptys: State<'_, Ptys>,
    session: String,
    cols: u16,
    rows: u16,
    on_data: Channel<InvokeResponseBody>,
    on_exit: Channel<Option<u32>>,
) -> Result<u32, String> {
    if session.is_empty() || !session.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(format!("not a session id: {session:?}"));
    }
    // Agent view (←) opens in the attach's cwd, and a background session only runs in a
    // trusted folder, so there it never asks for trust. A cwd that's gone is refused
    // rather than swapped for $HOME, which would ask (PLAN-sessions.md).
    let cwd = crate::session_cwd(&app, &session)
        .ok_or_else(|| format!("{session} isn't listed by `claude agents`"))?;
    if !Path::new(&cwd).is_dir() {
        return Err(format!("{cwd} no longer exists"));
    }
    let claude = resolver().get()?;
    let mut cmd = CommandBuilder::new(&claude.path);
    cmd.args(["attach", &session]);
    cmd.env_clear();
    for (key, value) in child_env(&claude) {
        cmd.env(key, value);
    }
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    // Invariant 3: the check and the insert happen under one lock, so two spawns for the
    // same session can't both get through. A PTY that is closing still counts until its
    // child is reaped, so a quick reattach waits for it instead of overlapping it.
    let mut live = ptys.live.lock().unwrap();
    let deadline = Instant::now() + SPAWN_WAIT;
    loop {
        match live.values().find(|pty| pty.session == session) {
            None => break,
            Some(pty) if pty.closing.is_none() => {
                return Err(format!("already attached to {session}"));
            }
            Some(_) => {
                let left = deadline.saturating_duration_since(Instant::now());
                if left.is_zero() {
                    return Err(format!("{session} is still detaching; try again"));
                }
                live = ptys.reaped.wait_timeout(live, left).unwrap().0;
            }
        }
    }
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let pid = child.process_id();
    // The master only reads EOF once every slave fd is closed.
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let killer = child.clone_killer();
    let flow = Arc::new(Flow::default());

    let id = ptys.next_id.fetch_add(1, Ordering::Relaxed);
    live.insert(
        id,
        Pty {
            session,
            pid,
            writer,
            master: pair.master,
            killer,
            flow: flow.clone(),
            closing: None,
            armed: false,
        },
    );
    drop(live);

    // macOS PTY reads return ~1KB, and each Channel message costs a round trip in the
    // webview, so a 20MB `cat` ran at 7MB/s. The sender drains whatever the reader has
    // queued into one message; a lone chunk (typing) still goes out at once.
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    let sender = thread::Builder::new()
        .name(format!("pty-{id}-send"))
        .spawn(move || {
            while let Ok(mut batch) = rx.recv() {
                while batch.len() < MAX_MESSAGE {
                    match rx.try_recv() {
                        Ok(more) => batch.extend_from_slice(&more),
                        Err(_) => break,
                    }
                }
                if on_data.send(InvokeResponseBody::Raw(batch)).is_err() {
                    break;
                }
            }
        })
        .map_err(|e| e.to_string())?;

    thread::Builder::new()
        .name(format!("pty-{id}-read"))
        .spawn(move || {
            let mut buf = vec![0u8; READ_CHUNK];
            while flow.wait_for_room() {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        flow.sent(n);
                        if tx.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                }
            }
            // All output reaches the webview before the exit notice.
            drop(tx);
            let _ = sender.join();
            let code = child.wait().ok().map(|status| status.exit_code());
            let ptys = app.state::<Ptys>();
            ptys.live.lock().unwrap().remove(&id);
            ptys.reaped.notify_all();
            let _ = on_exit.send(code);
        })
        .map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
pub fn pty_write(ptys: State<'_, Ptys>, id: u32, data: Vec<u8>) -> Result<(), String> {
    let mut live = ptys.live.lock().unwrap();
    let pty = live.get_mut(&id).filter(|pty| pty.closing.is_none()).ok_or("no such pty")?;
    pty.writer.write_all(&data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(ptys: State<'_, Ptys>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let live = ptys.live.lock().unwrap();
    let pty = live.get(&id).ok_or("no such pty")?;
    pty.master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

/// xterm.js has parsed `bytes` more output; lets the reader continue.
#[tauri::command]
pub fn pty_ack(ptys: State<'_, Ptys>, id: u32, bytes: usize) {
    if let Some(pty) = ptys.live.lock().unwrap().get(&id) {
        pty.flow.acked(bytes);
    }
}

#[tauri::command]
pub fn pty_kill(ptys: State<'_, Ptys>, id: u32) {
    if let Some(pty) = ptys.live.lock().unwrap().get_mut(&id) {
        pty.close();
    }
}

/// Called on app exit and page reload: detaches every PTY.
pub fn kill_all(ptys: &Ptys) {
    for pty in ptys.live.lock().unwrap().values_mut() {
        pty.close();
    }
}

/// Closes the PTY of every session that is no longer listed.
pub fn close_unlisted(ptys: &Ptys, sessions: &[Session]) {
    for pty in ptys.live.lock().unwrap().values_mut() {
        if !sessions.iter().any(|s| s.id.as_deref() == Some(pty.session.as_str())) {
            pty.close();
        }
    }
}

/// Starts the thread that, every `WATCH_EVERY`, detaches a child that was `claude attach
/// <id>` and no longer is (← exec'd agent view), and SIGKILLs one that has outlived its
/// hangup by `KILL_AFTER`.
pub fn watch(app: AppHandle) {
    thread::Builder::new()
        .name("pty-watch".into())
        .spawn(move || loop {
            thread::sleep(WATCH_EVERY);
            let ptys = app.state::<Ptys>();
            for pty in ptys.live.lock().unwrap().values_mut() {
                let Some(pid) = pty.pid else { continue };
                match pty.closing {
                    None => {
                        if left_attach(&mut pty.armed, argv(pid).as_deref(), &pty.session) {
                            pty.close();
                        }
                    }
                    Some(since) if since.elapsed() > KILL_AFTER => signal(pid, libc::SIGKILL),
                    Some(_) => {}
                }
            }
        })
        .expect("spawn the pty watch");
}

/// Whether the child has stopped being `attach <session>`, having been it: `armed` records
/// that it was. A child that is gone (`None`) is left to its reader, and one that hasn't
/// exec'd yet still has the app's own argv, which isn't a detach.
fn left_attach(armed: &mut bool, argv: Option<&[String]>, session: &str) -> bool {
    match argv {
        None => false,
        Some(argv) if still_attached(argv, session) => {
            *armed = true;
            false
        }
        Some(_) => *armed,
    }
}

/// Whether `argv` is still `… attach <session>`. Only the arguments are compared: after
/// ← `argv[0]` is the resolved binary, and a script fake runs as `sh <script> attach <id>`.
fn still_attached(argv: &[String], session: &str) -> bool {
    matches!(argv, [.., attach, id] if attach == "attach" && id == session)
}

/// Signals the child's whole process group when it leads one, as a PTY child does
/// (portable-pty calls `setsid`), so agent view's own children go with it. The daemon
/// is in a group of its own, so this never reaches it.
fn signal(pid: u32, sig: libc::c_int) {
    let pid = pid as libc::pid_t;
    unsafe {
        if libc::getpgid(pid) == pid {
            libc::killpg(pid, sig);
        } else {
            libc::kill(pid, sig);
        }
    }
}

/// A process's argv, from `sysctl(KERN_PROCARGS2)`; `None` once it's gone or unreadable.
fn argv(pid: u32) -> Option<Vec<String>> {
    let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid as libc::c_int];
    let mut size: libc::size_t = 0;
    let mut sysctl = |buf: *mut libc::c_void, size: &mut libc::size_t| unsafe {
        libc::sysctl(mib.as_mut_ptr(), 3, buf, size, std::ptr::null_mut(), 0)
    };
    if sysctl(std::ptr::null_mut(), &mut size) != 0 {
        return None;
    }
    let mut buf = vec![0u8; size];
    if sysctl(buf.as_mut_ptr().cast(), &mut size) != 0 {
        return None;
    }
    buf.truncate(size);
    parse_procargs(&buf)
}

/// `KERN_PROCARGS2` is `argc` (an int), the exec path, NUL padding, then `argc`
/// NUL-terminated arguments (and the environment after them).
fn parse_procargs(buf: &[u8]) -> Option<Vec<String>> {
    let argc = i32::from_ne_bytes(buf.get(..4)?.try_into().ok()?) as usize;
    let rest = &buf[4..];
    let rest = &rest[rest.iter().position(|&b| b == 0)?..];
    let rest = &rest[rest.iter().position(|&b| b != 0)?..];
    let args: Vec<String> =
        rest.split(|&b| b == 0).take(argc).map(|a| String::from_utf8_lossy(a).into()).collect();
    (args.len() == argc).then_some(args)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|a| a.to_string()).collect()
    }

    #[test]
    fn attach_and_agent_view_are_told_apart() {
        let id = "d661c9ee";
        assert!(still_attached(&args(&["/x/bin/claude", "attach", id]), id));
        assert!(still_attached(&args(&["/bin/sh", "/tmp/fake/claude", "attach", id]), id));
        assert!(!still_attached(&args(&["/x/claude-code/bin/claude.exe", "agents"]), id));
        assert!(!still_attached(&args(&["/x/bin/claude", "attach", "other"]), id));
        assert!(!still_attached(&args(&[]), id));
    }

    #[test]
    fn the_watch_arms_only_once_it_has_seen_the_attach() {
        let id = "abc123";
        let mut armed = false;
        // Before the fork has exec'd, the child's argv is the app's own.
        assert!(!left_attach(&mut armed, Some(&args(&["/x/oscillate"])), id));
        assert!(!left_attach(&mut armed, Some(&args(&["/x/claude", "attach", id])), id));
        assert!(armed);
        assert!(!left_attach(&mut armed, None, id));
        assert!(left_attach(&mut armed, Some(&args(&["/x/claude.exe", "agents"])), id));
    }

    #[test]
    fn argv_follows_an_exec_in_the_same_pid() {
        // As ← does: the same pid execs something that isn't `attach <id>`.
        let mut child = Command::new("/bin/sh")
            .args(["-c", "sleep 0.5; exec /bin/sleep 5", "sh", "attach", "abc123"])
            .spawn()
            .unwrap();
        let pid = child.id();
        thread::sleep(Duration::from_millis(100));
        let before = argv(pid).unwrap();
        assert_eq!(before[1..], args(&["-c", "sleep 0.5; exec /bin/sleep 5", "sh", "attach", "abc123"]));
        assert!(still_attached(&before, "abc123"));
        thread::sleep(Duration::from_millis(900));
        let after = argv(pid).unwrap();
        assert_eq!(after, args(&["/bin/sleep", "5"]));
        assert!(!still_attached(&after, "abc123"));
        child.kill().unwrap();
        child.wait().unwrap();
        assert_eq!(argv(pid), None);
    }
}
