//! Notifications and the Dock badge (PLAN-notifications.md). `attention.rs` decides what
//! deserves one; this posts it.
//!
//! Notifications go through our own `UNUserNotificationCenter` delegate, not a plugin. macOS
//! only delivers them to a bundled app, so there are three sinks:
//! - `MacSink` in a `.app`: real notifications, and the delegate that hears taps;
//! - `NoSink` in an unbundled `tauri dev`: nothing, with one log line;
//! - `LogSink` in the e2e build when `OSCILLATE_E2E_NOTIFY_LOG` is set: JSON lines the
//!   harness reads, since the e2e app is built `--no-bundle` too.
//!
//! The Dock badge is Tauri's `set_badge_count` in every sink but `LogSink`.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

use crate::attention::{self, Attention, Note};
use crate::sessions::Session;

pub trait Sink: Send + Sync {
    fn post(&self, note: &Note);
    fn remove(&self, id: &str);
    /// `None` clears the badge.
    fn badge(&self, count: Option<usize>);
}

/// What a notification's response was. Only a tap opens anything.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Response {
    Tap,
    Dismiss,
}

pub struct Notifier {
    attention: Mutex<Attention>,
    /// The id whose pane the page shows, if any (`set_visible_session`).
    selected: Mutex<Option<String>>,
    /// The badge as last set; `None` before the first list.
    badge: Mutex<Option<usize>>,
    sink: Box<dyn Sink>,
}

impl Notifier {
    /// Picks the sink, and in a bundled app sets the delegate and asks for permission.
    /// Call it on the main thread, in `setup`.
    pub fn new(app: &AppHandle) -> Notifier {
        Notifier {
            attention: Mutex::default(),
            selected: Mutex::default(),
            badge: Mutex::default(),
            sink: sink(app),
        }
    }

    /// Every new session list, on the poll thread. `added` are the added repos, so the
    /// subtitle is the group label the sidebar shows.
    pub fn on_list(&self, app: &AppHandle, list: &[Session], added: &[String]) {
        let labels =
            attention::labels(list.iter().map(|s| s.cwd.as_str()).chain(added.iter().map(String::as_str)));
        let notes = self.attention.lock().unwrap().update(list, &labels);
        if !notes.is_empty() {
            let selected = self.selected.lock().unwrap().clone();
            let (focused, minimized) = focus(app);
            for note in notes {
                if !attention::visible(selected.as_deref(), focused, minimized, &note.id) {
                    self.sink.post(&note);
                }
            }
        }
        let count = attention::needs_you(list);
        let mut badge = self.badge.lock().unwrap();
        if *badge != Some(count) {
            *badge = Some(count);
            self.sink.badge((count > 0).then_some(count));
        }
    }

    /// The page's selection. Opening a session removes its delivered notification.
    pub fn set_visible(&self, id: Option<String>) {
        if let Some(id) = &id {
            self.sink.remove(id);
        }
        *self.selected.lock().unwrap() = id;
    }
}

/// A notification was tapped or dismissed. A tap brings the window forward and, if the
/// session is still listed, has the page open it as a row click does.
pub fn respond(app: &AppHandle, id: &str, response: Response) {
    if response != Response::Tap {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    if crate::session_cwd(app, id).is_some() {
        let _ = app.emit("open-session", id);
    }
}

/// Whether the main window is key, and whether it's minimized. In the e2e build, the
/// file `OSCILLATE_E2E_FOCUS` names (`key`, `background` or `minimized`) answers instead,
/// so specs don't depend on which app macOS has in front.
fn focus(app: &AppHandle) -> (bool, bool) {
    #[cfg(feature = "e2e")]
    if let Some(file) = std::env::var_os("OSCILLATE_E2E_FOCUS") {
        match std::fs::read_to_string(file).unwrap_or_default().trim() {
            "key" => return (true, false),
            "background" => return (false, false),
            "minimized" => return (false, true),
            _ => {}
        }
    }
    match app.get_webview_window("main") {
        Some(w) => (w.is_focused().unwrap_or(false), w.is_minimized().unwrap_or(false)),
        None => (false, false),
    }
}

fn sink(app: &AppHandle) -> Box<dyn Sink> {
    #[cfg(feature = "e2e")]
    if let Some(path) = std::env::var_os("OSCILLATE_E2E_NOTIFY_LOG").filter(|p| !p.is_empty()) {
        return Box::new(LogSink(path.into()));
    }
    #[cfg(target_os = "macos")]
    if bundled() {
        return Box::new(mac::MacSink::start(app));
    }
    eprintln!("oscillate: notifications need a bundled app; this run posts none");
    Box::new(NoSink(app.clone()))
}

/// macOS only delivers notifications to an app bundle, and asking without one throws.
#[cfg(target_os = "macos")]
fn bundled() -> bool {
    std::env::current_exe()
        .map(|exe| exe.to_string_lossy().contains(".app/Contents/MacOS/"))
        .unwrap_or(false)
}

fn dock_badge(app: &AppHandle, count: Option<usize>) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(e) = window.set_badge_count(count.map(|c| c as i64)) {
            eprintln!("oscillate: couldn't set the Dock badge: {e}");
        }
    }
}

struct NoSink(AppHandle);

impl Sink for NoSink {
    fn post(&self, _: &Note) {}
    fn remove(&self, _: &str) {}
    fn badge(&self, count: Option<usize>) {
        dock_badge(&self.0, count);
    }
}

#[cfg(feature = "e2e")]
struct LogSink(std::path::PathBuf);

#[cfg(feature = "e2e")]
impl LogSink {
    fn write(&self, mut line: serde_json::Value) {
        use std::io::Write;
        let at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        line["at"] = at.into();
        let file = std::fs::OpenOptions::new().create(true).append(true).open(&self.0);
        if let Err(e) = file.and_then(|mut f| writeln!(f, "{line}")) {
            eprintln!("oscillate: couldn't write the notify log: {e}");
        }
    }
}

#[cfg(feature = "e2e")]
impl Sink for LogSink {
    fn post(&self, n: &Note) {
        self.write(serde_json::json!({
            "op": "post", "id": n.id, "title": n.title, "subtitle": n.subtitle, "body": n.body,
        }));
    }
    fn remove(&self, id: &str) {
        self.write(serde_json::json!({ "op": "remove", "id": id }));
    }
    fn badge(&self, count: Option<usize>) {
        self.write(serde_json::json!({ "op": "badge", "count": count }));
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use std::sync::OnceLock;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{Bool, NSObject, NSObjectProtocol, ProtocolObject};
    use objc2::{define_class, msg_send, ClassType};
    use objc2_foundation::{NSArray, NSError, NSString};
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNMutableNotificationContent, UNNotification,
        UNNotificationDefaultActionIdentifier, UNNotificationDismissActionIdentifier,
        UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationResponse,
        UNNotificationSound, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
    };
    use tauri::AppHandle;

    use super::{dock_badge, respond, Note, Response, Sink};

    /// What the delegate calls back into; set once, before the delegate is.
    static APP: OnceLock<AppHandle> = OnceLock::new();

    define_class!(
        // SAFETY: NSObject has no subclassing requirements, and the delegate has no
        // ivars and no `Drop`.
        #[unsafe(super(NSObject))]
        #[name = "OscillateNotificationDelegate"]
        struct Delegate;

        unsafe impl NSObjectProtocol for Delegate {}

        unsafe impl UNUserNotificationCenterDelegate for Delegate {
            /// Without this, macOS hides banners while Oscillate is frontmost, and a
            /// session that isn't selected would notify unseen.
            #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
            fn will_present(
                &self,
                _center: &UNUserNotificationCenter,
                _notification: &UNNotification,
                handler: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
            ) {
                handler.call((UNNotificationPresentationOptions::Banner
                    | UNNotificationPresentationOptions::List
                    | UNNotificationPresentationOptions::Sound,));
            }

            #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
            fn did_receive(
                &self,
                _center: &UNUserNotificationCenter,
                response: &UNNotificationResponse,
                handler: &block2::DynBlock<dyn Fn()>,
            ) {
                let action = response.actionIdentifier();
                // SAFETY: framework constants, valid for the life of the process.
                let (tap, dismiss) =
                    unsafe { (UNNotificationDefaultActionIdentifier, UNNotificationDismissActionIdentifier) };
                let kind = if *action == *tap {
                    Some(Response::Tap)
                } else if *action == *dismiss {
                    Some(Response::Dismiss)
                } else {
                    None
                };
                let id = response.notification().request().identifier().to_string();
                if let (Some(kind), Some(app)) = (kind, APP.get()) {
                    respond(app, &id, kind);
                }
                handler.call(());
            }
        }
    );

    pub struct MacSink(AppHandle);

    impl MacSink {
        /// Sets the delegate and asks for permission once. A denial is logged, never shown.
        pub fn start(app: &AppHandle) -> MacSink {
            let _ = APP.set(app.clone());
            let center = UNUserNotificationCenter::currentNotificationCenter();
            // SAFETY: `new` on an NSObject subclass with no ivars.
            let delegate: Retained<Delegate> = unsafe { msg_send![Delegate::class(), new] };
            center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
            // The center holds its delegate weakly; this one lives as long as the app.
            std::mem::forget(delegate);
            let answered = RcBlock::new(|granted: Bool, error: *mut NSError| {
                if !granted.as_bool() {
                    // SAFETY: the framework passes a valid NSError or null.
                    let why = unsafe { error.as_ref() }.map(|e| e.localizedDescription().to_string());
                    eprintln!("oscillate: notifications not allowed ({})", why.unwrap_or_default());
                }
            });
            center.requestAuthorizationWithOptions_completionHandler(
                UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
                &answered,
            );
            MacSink(app.clone())
        }
    }

    impl Sink for MacSink {
        fn post(&self, n: &Note) {
            let content = UNMutableNotificationContent::new();
            content.setTitle(&NSString::from_str(&n.title));
            content.setSubtitle(&NSString::from_str(&n.subtitle));
            content.setBody(&NSString::from_str(&n.body));
            content.setSound(Some(&UNNotificationSound::defaultSound()));
            // The id is the identifier, so a newer one for the same session replaces it.
            let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
                &NSString::from_str(&n.id),
                &content,
                None,
            );
            let id = n.id.clone();
            let done = RcBlock::new(move |error: *mut NSError| {
                // SAFETY: the framework passes a valid NSError or null.
                if let Some(e) = unsafe { error.as_ref() } {
                    eprintln!("oscillate: notification for {id} not posted: {}", e.localizedDescription());
                }
            });
            UNUserNotificationCenter::currentNotificationCenter()
                .addNotificationRequest_withCompletionHandler(&request, Some(&done));
        }

        fn remove(&self, id: &str) {
            let ids = NSArray::from_retained_slice(&[NSString::from_str(id)]);
            UNUserNotificationCenter::currentNotificationCenter().removeDeliveredNotificationsWithIdentifiers(&ids);
        }

        fn badge(&self, count: Option<usize>) {
            dock_badge(&self.0, count);
        }
    }
}
