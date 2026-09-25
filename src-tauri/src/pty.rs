//! PTYs owned by Rust, streamed to xterm.js over a Tauri `Channel`.
//!
//! Output is sent as raw bytes. The reader thread pauses once `HIGH_WATER` bytes are in
//! flight to the webview, and resumes as xterm.js acks what it has parsed. That
//! backpressure reaches the child through the PTY, so a flood can't pile up in the
//! webview and Ctrl+C stays prompt (PLAN-terminal.md, item 7).

use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, State};

use crate::claude::claude_bin;

const READ_CHUNK: usize = 64 * 1024;
const MAX_MESSAGE: usize = 256 * 1024;
const HIGH_WATER: usize = 1024 * 1024;

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
}

struct Pty {
    /// The session this PTY runs `claude attach` for; `None` for a shell.
    session: Option<String>,
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    flow: Arc<Flow>,
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

/// Spawns `claude attach <session>`, or the user's login shell in `$HOME` when there is
/// no session, and returns the PTY's id.
#[tauri::command(async)]
pub fn pty_spawn(
    app: AppHandle,
    ptys: State<'_, Ptys>,
    session: Option<String>,
    cols: u16,
    rows: u16,
    on_data: Channel<InvokeResponseBody>,
    on_exit: Channel<Option<u32>>,
) -> Result<u32, String> {
    let mut cmd = match &session {
        Some(session) => {
            if session.is_empty() || !session.chars().all(|c| c.is_ascii_alphanumeric()) {
                return Err(format!("not a session id: {session:?}"));
            }
            let claude = claude_bin()?;
            let mut cmd = CommandBuilder::new(claude.path);
            cmd.args(["attach", session]);
            cmd.env_clear();
            for (key, value) in clean_env() {
                cmd.env(key, value);
            }
            cmd.env("PATH", claude.path_var);
            cmd
        }
        None => {
            // `new_default_prog` runs $SHELL as a login shell (argv[0] = "-zsh").
            let mut cmd = CommandBuilder::new_default_prog();
            cmd.env_clear();
            for (key, value) in clean_env() {
                cmd.env(key, value);
            }
            cmd
        }
    };
    if let Some(home) = std::env::var_os("HOME") {
        cmd.cwd(home);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    // Invariant 3: the check and the insert happen under one lock, so two spawns for the
    // same session can't both get through.
    let mut live = ptys.live.lock().unwrap();
    if session.is_some() && live.values().any(|pty| pty.session == session) {
        return Err(format!("already attached to {}", session.unwrap()));
    }
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    // The master only reads EOF once every slave fd is closed.
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let killer = child.clone_killer();
    let flow = Arc::new(Flow::default());

    let id = ptys.next_id.fetch_add(1, Ordering::Relaxed);
    live.insert(id, Pty { session, writer, master: pair.master, killer, flow: flow.clone() });
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
            app.state::<Ptys>().live.lock().unwrap().remove(&id);
            let _ = on_exit.send(code);
        })
        .map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
pub fn pty_write(ptys: State<'_, Ptys>, id: u32, data: Vec<u8>) -> Result<(), String> {
    let mut live = ptys.live.lock().unwrap();
    let pty = live.get_mut(&id).ok_or("no such pty")?;
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
    if let Some(mut pty) = ptys.live.lock().unwrap().remove(&id) {
        kill(&mut pty);
    }
}

/// Called on app exit. For a shell this ends it; for `claude attach` it detaches.
pub fn kill_all(ptys: &Ptys) {
    for (_, mut pty) in ptys.live.lock().unwrap().drain() {
        kill(&mut pty);
    }
}

fn kill(pty: &mut Pty) {
    pty.flow.close();
    let _ = pty.killer.kill();
}
