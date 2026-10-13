//! The macOS main window lays its WebView under a transparent titlebar ("Overlay"), so the page
//! paints that band with its own backgrounds and backdrops. A native view keeps the band's drag
//! and double-click with AppKit; `--titlebar-inset` tells the page how much of its top to keep
//! clear for them. Other platforms keep their native titlebar and an inset of 0.
use tauri::{AppHandle, WebviewWindow, WebviewWindowBuilder, Wry};

#[cfg(target_os = "macos")]
mod os {
    use std::ffi::c_void;
    unsafe extern "C" {
        pub fn index_titlebar_height() -> f64;
        pub fn index_titlebar_inset(window: *mut c_void) -> f64;
        pub fn index_titlebar_install(window: *mut c_void);
    }
}

#[cfg(target_os = "macos")]
static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn inset_script(inset: f64) -> String {
    format!("document.documentElement.style.setProperty('--titlebar-inset','{inset}px');")
}

/// Sets the inset before the page's first paint, and again after each load in case the
/// window entered full screen since it was created.
pub fn prepare<'a>(builder: WebviewWindowBuilder<'a, Wry, AppHandle>) -> WebviewWindowBuilder<'a, Wry, AppHandle> {
    #[cfg(target_os = "macos")]
    return builder
        .initialization_script(inset_script(unsafe { os::index_titlebar_height() }))
        .on_page_load(|window, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) { apply(&window); }
        });
    #[cfg(not(target_os = "macos"))]
    builder
}

/// Call on the main thread after building, so the band sits above the WebView.
pub fn install(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;
        let _ = APP.set(window.app_handle().clone());
        if let Ok(pointer) = window.ns_window() { unsafe { os::index_titlebar_install(pointer) }; }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

#[cfg(target_os = "macos")]
fn apply(window: &WebviewWindow) {
    if let Ok(pointer) = window.ns_window() {
        let _ = window.eval(inset_script(unsafe { os::index_titlebar_inset(pointer) }));
    }
}

/// Called by the native view when full screen hides or restores the titlebar.
#[cfg(target_os = "macos")]
#[unsafe(no_mangle)]
pub extern "C" fn index_titlebar_changed() {
    use tauri::Manager;
    if let Some(window) = APP.get().and_then(|app| app.get_webview_window("main")) { apply(&window); }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn inset_is_a_css_length() {
        assert_eq!(inset_script(28.0), "document.documentElement.style.setProperty('--titlebar-inset','28px');");
        assert_eq!(inset_script(0.0), "document.documentElement.style.setProperty('--titlebar-inset','0px');");
    }
}
