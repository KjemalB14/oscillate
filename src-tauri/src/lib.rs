mod claude;
mod pty;

use tauri::webview::PageLoadEvent;
use tauri::{Manager, RunEvent};

/// The session the pane attaches to, passed in by hand until chapter 2's sidebar:
/// `OSCILLATE_ATTACH=<id> npm run tauri dev`. Unset, the pane runs a login shell.
#[tauri::command]
fn initial_session() -> Option<String> {
    std::env::var("OSCILLATE_ATTACH").ok().filter(|id| !id.is_empty())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(pty::Ptys::default())
        // A reload drops the page without running React cleanup; its PTYs would be orphaned.
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Started {
                pty::kill_all(&webview.state::<pty::Ptys>());
            }
        })
        .invoke_handler(tauri::generate_handler![
            initial_session,
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
