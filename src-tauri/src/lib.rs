mod claude;
mod newsession;
mod poll;
mod pty;
mod repos;
mod sessions;
#[cfg(test)]
mod testutil;
mod watch;

use std::path::PathBuf;
use std::sync::mpsc::{self, Sender};

use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

/// The session model's live parts: the poll thread and the file-watch feeding it.
struct SessionModel {
    poller: poll::Poller,
    /// Asks the poll thread for a poll now, as a file-watch event does.
    poll_now: Sender<()>,
    _watcher: Option<notify::RecommendedWatcher>,
}

/// The session's `cwd` as the last good poll reported it; where its attach runs.
pub(crate) fn session_cwd(app: &AppHandle, id: &str) -> Option<String> {
    let model = app.try_state::<SessionModel>()?;
    let sessions = model.poller.snapshot()?;
    sessions.into_iter().find(|s| s.id.as_deref() == Some(id)).map(|s| s.cwd)
}

/// The last good session list, or `null` before the first good poll;
/// `sessions-changed` carries every later one.
#[tauri::command]
fn sessions_snapshot(model: State<'_, SessionModel>) -> Option<Vec<sessions::Session>> {
    model.poller.snapshot()
}

/// Starts a session with `claude --bg` in `cwd` and returns its id, or the error to show
/// verbatim. Polls at once, so the new row shows without waiting for the next timed poll.
#[tauri::command(async)]
fn start_session(
    model: State<'_, SessionModel>,
    cwd: String,
    mode: Option<String>,
    prompt: String,
) -> Result<String, String> {
    let id = newsession::start(&claude::resolver(), &cwd, mode.as_deref(), &prompt)?;
    let _ = model.poll_now.send(());
    Ok(id)
}

#[tauri::command]
fn repos_list(repos: State<'_, repos::Repos>) -> Vec<String> {
    repos.list()
}

/// "Add repo…": asks for a folder and adds it. Cancelling returns the list unchanged.
#[tauri::command(async)]
fn repos_add(app: AppHandle, repos: State<'_, repos::Repos>) -> Result<Vec<String>, String> {
    match repos::pick_folder(&app) {
        Some(dir) => repos.add(&dir),
        None => Ok(repos.list()),
    }
}

#[tauri::command]
fn repos_remove(repos: State<'_, repos::Repos>, path: String) -> Result<Vec<String>, String> {
    repos.remove(&path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());
    #[cfg(feature = "e2e")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());
    builder
        .manage(pty::Ptys::default())
        .setup(|app| {
            let resolver = claude::resolver();
            resolver.clone().warm();
            // `OSCILLATE_CLAUDE_DIR` points the watch at a temp dir in e2e runs.
            let claude_dir = std::env::var_os("OSCILLATE_CLAUDE_DIR")
                .filter(|d| !d.is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".claude")
                });
            let (tx, rx) = mpsc::channel();
            let poll_now = tx.clone();
            let watcher = watch::watch(&[claude_dir.join("sessions"), claude_dir.join("jobs")], tx);
            let handle = app.handle().clone();
            let poller = poll::Poller::start(resolver, Default::default(), rx, move |list| {
                pty::close_unlisted(&handle.state::<pty::Ptys>(), list);
                let _ = handle.emit("sessions-changed", list);
            });
            app.manage(SessionModel { poller, poll_now, _watcher: watcher });
            // `OSCILLATE_DATA_DIR` keeps e2e runs' `repos.json` in their temp dir.
            let data_dir = match std::env::var_os("OSCILLATE_DATA_DIR").filter(|d| !d.is_empty()) {
                Some(dir) => PathBuf::from(dir),
                None => app.path().app_data_dir()?,
            };
            app.manage(repos::Repos::load(&data_dir));
            pty::watch(app.handle().clone());
            Ok(())
        })
        // A reload drops the page without running React cleanup; its PTYs would be orphaned.
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Started {
                pty::kill_all(&webview.state::<pty::Ptys>());
            }
        })
        .invoke_handler(tauri::generate_handler![
            sessions_snapshot,
            start_session,
            repos_list,
            repos_add,
            repos_remove,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_ack,
            pty::pty_kill,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                pty::kill_all(&app.state::<pty::Ptys>());
            }
        });
}
