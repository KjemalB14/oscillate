mod attention;
mod avatars;
mod claude;
mod endsession;
mod glass;
mod layout;
mod newsession;
mod notifications;
mod poll;
mod pr_links;
mod pty;
mod repos;
mod sessions;
#[cfg(test)]
mod testutil;
mod watch;

use std::path::{Path, PathBuf};
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

/// Stop or Remove, from a row's menu: `claude stop <id>` or `claude rm <id>`. The row's
/// attach, if any, is closed and reaped first, and none is admitted until the command has
/// returned. A failure, such as `rm`'s refusal, comes back verbatim. Polls at once, so the
/// row updates without waiting for the next timed poll.
#[tauri::command(async)]
fn end_session(
    app: AppHandle,
    model: State<'_, SessionModel>,
    ptys: State<'_, pty::Ptys>,
    id: String,
    end: endsession::End,
) -> Result<(), String> {
    endsession::args(end, &id)?;
    let _no_attach = pty::end_attaches(&ptys, &id)?;
    // Where the session ran, if that's still there; `stop` and `rm` work from anywhere.
    let cwd = session_cwd(&app, &id)
        .filter(|cwd| Path::new(cwd).is_dir())
        .or_else(|| std::env::var("HOME").ok())
        .unwrap_or_else(|| "/".into());
    let result = endsession::run(&claude::resolver(), end, &id, &cwd);
    let _ = model.poll_now.send(());
    result
}

/// The session whose pane the page shows, or `null`. Its transitions aren't notified
/// while the window is key, and opening it removes its delivered notification.
#[tauri::command]
fn set_visible_session(notifier: State<'_, notifications::Notifier>, id: Option<String>) {
    notifier.set_visible(id);
}

/// The e2e build's stand-in for a tap or a dismissal on a real notification: it runs the
/// delegate's own handler. Any other build refuses it.
#[tauri::command]
fn e2e_notification_response(app: AppHandle, id: String, action: String) -> Result<(), String> {
    if !cfg!(feature = "e2e") {
        return Err("e2e builds only".into());
    }
    let response = match action.as_str() {
        "tap" => notifications::Response::Tap,
        "dismiss" => notifications::Response::Dismiss,
        other => return Err(format!("unknown action {other:?}")),
    };
    notifications::respond(&app, &id, response);
    Ok(())
}

/// A PR chip's click: opens `href` in the default browser. Only an `https://` link that a
/// listed session names is opened. In e2e builds, `OSCILLATE_E2E_OPEN_LOG` names a file
/// it's appended to instead.
#[tauri::command]
fn open_pr(app: AppHandle, model: State<'_, SessionModel>, href: String) -> Result<(), String> {
    let listed = model
        .poller
        .snapshot()
        .is_some_and(|list| list.iter().any(|s| s.prs.iter().any(|p| p.href == href)));
    if !href.starts_with("https://") || !listed {
        return Err(format!("not a listed PR link: {href}"));
    }
    #[cfg(feature = "e2e")]
    if let Some(log) = std::env::var_os("OSCILLATE_E2E_OPEN_LOG").filter(|l| !l.is_empty()) {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new().create(true).append(true).open(log).map_err(|e| e.to_string())?;
        return writeln!(file, "{href}").map_err(|e| e.to_string());
    }
    eprintln!("oscillate: opening {href}");
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(href, None::<&str>).map_err(|e| e.to_string())
}

/// Whether the glass is behind the window; the page paints it opaque if not.
#[tauri::command]
fn glass_state(glass: State<'_, glass::Glass>) -> bool {
    glass.0
}

/// A group's avatar as a `data:` URL, or `null` for the folder glyph (`avatars.rs`). Only
/// a directory the app is listing, as a session's `cwd` or an added repo, is looked at.
#[tauri::command(async)]
fn repo_avatar(
    model: State<'_, SessionModel>,
    repos: State<'_, repos::Repos>,
    avatars: State<'_, avatars::Avatars>,
    cwd: String,
) -> Option<String> {
    let listed = repos.list().contains(&cwd)
        || model.poller.snapshot().is_some_and(|list| list.iter().any(|s| s.cwd == cwd));
    if !listed {
        return None;
    }
    avatars.get(Path::new(&cwd)).0
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

#[tauri::command]
fn layout_get(layout: State<'_, layout::Layout>) -> layout::Sidebar {
    layout.get()
}

/// Stores the sidebar's width (clamped) and collapsed state; returns what was stored.
#[tauri::command]
fn layout_set(layout: State<'_, layout::Layout>, next: layout::Sidebar) -> Result<layout::Sidebar, String> {
    layout.set(next)
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
            // `OSCILLATE_DATA_DIR` keeps e2e runs' `repos.json` and `layout.json` in their
            // temp dir.
            let data_dir = match std::env::var_os("OSCILLATE_DATA_DIR").filter(|d| !d.is_empty()) {
                Some(dir) => PathBuf::from(dir),
                None => app.path().app_data_dir()?,
            };
            // Both before the poller, whose first list reads them.
            app.manage(repos::Repos::load(&data_dir));
            app.manage(layout::Layout::load(&data_dir));
            app.manage(avatars::Avatars::new(&data_dir, &claude_dir));
            app.manage(notifications::Notifier::new(app.handle()));
            let (tx, rx) = mpsc::channel();
            let poll_now = tx.clone();
            let watcher = watch::watch(&[claude_dir.join("sessions"), claude_dir.join("jobs")], tx);
            let handle = app.handle().clone();
            let pr_links = pr_links::PrLinks::new(claude_dir.join("jobs"));
            let poller = poll::Poller::start(resolver, Default::default(), rx, Some(pr_links), move |list| {
                pty::close_unlisted(&handle.state::<pty::Ptys>(), list);
                let _ = handle.emit("sessions-changed", list);
                let added = handle.state::<repos::Repos>().list();
                handle.state::<notifications::Notifier>().on_list(&handle, list, &added);
            });
            app.manage(SessionModel { poller, poll_now, _watcher: watcher });
            pty::watch(app.handle().clone());
            app.set_menu(menu(app.handle())?)?;
            let window = app.get_webview_window("main").ok_or("no main window")?;
            app.manage(glass::apply(&window));
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
            end_session,
            quit,
            repos_list,
            repos_add,
            repos_remove,
            layout_get,
            layout_set,
            set_visible_session,
            open_pr,
            glass_state,
            repo_avatar,
            e2e_notification_response,
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
