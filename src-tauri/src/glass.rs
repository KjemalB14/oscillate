//! Liquid Glass behind the whole window (PLAN-ui-pass.md, slice 2). An `NSGlassEffectView`
//! sits under the webview, which is transparent (`macOSPrivateApi`), and the page's own
//! surfaces tint it. Our own objc2 code, as `notifications.rs` is, not a plugin.
//!
//! The glass is off when `OSCILLATE_GLASS=off`, or when the class is missing (it's macOS
//! 26's). Then the page paints the window opaque in `--window`, and one line says why.

/// Whether the glass is behind the window. The page asks with `glass_state`.
pub struct Glass(pub bool);

/// Puts the glass under the window's webview. Call it on the main thread, in `setup`.
pub fn apply(window: &tauri::WebviewWindow) -> Glass {
    let off = |why: &str| {
        eprintln!("oscillate: glass off ({why}); the window is opaque");
        Glass(false)
    };
    if std::env::var("OSCILLATE_GLASS").is_ok_and(|v| v == "off") {
        return off("OSCILLATE_GLASS=off");
    }
    #[cfg(target_os = "macos")]
    return match mac::insert(window) {
        Ok(()) => {
            eprintln!("oscillate: glass on");
            Glass(true)
        }
        Err(why) => off(&why),
    };
    #[cfg(not(target_os = "macos"))]
    off("not macOS")
}

#[cfg(target_os = "macos")]
mod mac {
    use objc2::runtime::AnyClass;
    use objc2::{MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{
        NSAutoresizingMaskOptions, NSGlassEffectView, NSGlassEffectViewStyle, NSWindow,
        NSWindowOrderingMode,
    };

    /// The glass as the content view's bottom subview, the window's size, under the webview.
    pub fn insert(window: &tauri::WebviewWindow) -> Result<(), String> {
        if AnyClass::get(c"NSGlassEffectView").is_none() {
            return Err("NSGlassEffectView is missing; it needs macOS 26".into());
        }
        let mtm = MainThreadMarker::new().ok_or("not on the main thread")?;
        let ns_window = window.ns_window().map_err(|e| e.to_string())?;
        // SAFETY: Tauri hands back this window's live NSWindow, on the main thread.
        let ns_window: &NSWindow = unsafe { &*ns_window.cast() };
        let content = ns_window.contentView().ok_or("the window has no content view")?;
        let glass = NSGlassEffectView::initWithFrame(NSGlassEffectView::alloc(mtm), content.bounds());
        glass.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
        glass.setStyle(NSGlassEffectViewStyle::Regular);
        glass.setCornerRadius(0.0);
        content.addSubview_positioned_relativeTo(&glass, NSWindowOrderingMode::Below, None);
        Ok(())
    }
}
