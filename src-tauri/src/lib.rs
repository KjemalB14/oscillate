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

use tauri::menu::{Menu, MenuItem, MenuItemKind};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};

/// Why quitting is refused while the trust pane's `claude` runs: quitting would hang it
/// up, and the app never kills it (PLAN-new-sessions.md, *Trust*).
const TRUST_FIRST: &str = "Answer the trust prompt first";

/// Whether quitting must wait for the trust prompt. If so, the page is told, so it can
/// say why and show the pane.
fn quit_refused(app: &AppHandle) -> bool {
    let open = pty::trust_info(&app.state::<pty::Ptys>()).is_some();
    if open {
        let _ = app.emit("quit-refused", TRUST_FIRST);
    }
    open
}

/// Cmd+Q and the Quit menu item. The page sends Cmd+Q here too, since the menu's
/// accelerator never sees a key that is dispatched in the page.
#[tauri::command]
fn quit(app: AppHandle) -> Result<(), String> {
    if quit_refused(&app) {
        return Err(TRUST_FIRST.into());
    }
    app.exit(0);
    Ok(())
}

/// The stock macOS menu with its Quit swapped for one the app can refuse: the stock item
/// sends `terminate:`, which tao ends the process on without asking.
fn menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::default(app)?;
    if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
        for item in app_menu.items()? {
            if let MenuItemKind::Predefined(p) = &item {
                if p.text()?.starts_with("Quit") {
                    app_menu.remove(p)?;
                }
            }
        }
        app_menu.append(&MenuItem::with_id(app, "quit", "Quit Oscillate", true, Some("CmdOrCtrl+Q"))?)?;
    }
    Ok(menu)
}

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
/// verbatim, marked when it's the trust error. Polls at once, so the new row shows
/// without waiting for the next timed poll.
#[tauri::command(async)]
fn start_session(
    model: State<'_, SessionModel>,
    cwd: String,
    mode: Option<String>,
    prompt: String,
) -> Result<String, newsession::StartError> {
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
            app.set_menu(menu(app.handle())?)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == "quit" {
                let _ = quit(app.clone());
            }
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if quit_refused(window.app_handle()) {
                    api.prevent_close();
                }
            }
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
            quit,
            repos_list,
            repos_add,
            repos_remove,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_ack,
            pty::pty_kill,
            pty::trust_open,
            pty::trust_current,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            RunEvent::ExitRequested { api, .. } if quit_refused(app) => api.prevent_exit(),
            // The trust PTY is passed by; its `claude` would only get the kernel's hangup.
            RunEvent::Exit => pty::kill_all(&app.state::<pty::Ptys>()),
            _ => {}
        });
}
