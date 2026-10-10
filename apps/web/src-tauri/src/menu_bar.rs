//! One main window, one reusable compact window, and one process-owned status item.
use serde::Serialize;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

static MENU_REQUESTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static APP: OnceLock<AppHandle> = OnceLock::new();
static NAVIGATION: Mutex<Option<PendingNavigation>> = Mutex::new(None);
static NEXT_NAVIGATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingNavigation { id: u64, path: String, recipient_id: Option<String> }
#[derive(Clone, Serialize)]
struct DataChanged { revision: u64, source: String }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginStatus { supported: bool, state: &'static str }
fn login_status(code: i32) -> LoginStatus {
    LoginStatus { supported: code >= 0, state: match code {
        0 => "off", 1 => "enabled", 2 => "requires-approval", 3 => "not-found", _ => "unsupported",
    } }
}
#[cfg(target_os = "macos")]
mod os {
    use std::ffi::c_void;
    unsafe extern "C" {
        pub fn index_menu_init(image: *const u8, length: usize) -> i32;
        pub fn index_menu_present(window: *mut c_void);
        pub fn index_login_status() -> i32;
        pub fn index_login_set(enabled: bool) -> i32;
        pub fn index_login_settings();
    }
}
pub fn init(app: &AppHandle) -> Result<bool, String> {
    let _ = APP.set(app.clone());
    #[cfg(all(target_os = "macos", not(feature = "native-smoke")))]
    {
        let image = include_bytes!("../icons/menu-bar.pdf");
        return match unsafe { os::index_menu_init(image.as_ptr(), image.len()) } {
            1 => Ok(true), 0 => Ok(false), _ => Err("Could not create the Index menu bar item.".into()),
        };
    }
    #[cfg(any(not(target_os = "macos"), feature = "native-smoke"))]
    Ok(true)
}
/// Called by native notifications and repeat launches. Always targets main, never panel.
#[cfg(target_os = "macos")]
#[unsafe(no_mangle)]
pub extern "C" fn index_show_main() {
    if let Some(app) = APP.get() { let _ = show_main(app); }
}
#[cfg(target_os = "macos")]
#[unsafe(no_mangle)]
pub extern "C" fn index_menu_toggle() {
    if let Some(app) = APP.get() {
        if let Err(_) = toggle(app) { let _ = show_main(app); }
    }
}
pub fn ensure_main(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(window) = app.get_webview_window("main") { return Ok(window); }
    let config = app.config().app.windows.first().expect("main window configuration");
    let window = crate::restrict_navigation(WebviewWindowBuilder::from_config(app, config)?, app).build()?;
    attach_lifecycle(&window);
    Ok(window)
}
pub fn show_main(app: &AppHandle) -> tauri::Result<()> {
    let window = ensure_main(app)?;
    MENU_REQUESTED.store(false, std::sync::atomic::Ordering::SeqCst);
    if let Some(panel) = app.get_webview_window("menu-bar") { let _ = panel.hide(); }
    window.unminimize()?;
    window.show()?;
    window.set_focus()?;
    let _ = window.emit("index:desktop-open", ());
    Ok(())
}
#[cfg(target_os = "macos")]
fn toggle(app: &AppHandle) -> tauri::Result<()> {
    let window = if let Some(window) = app.get_webview_window("menu-bar") {
        if window.is_visible()? || MENU_REQUESTED.load(std::sync::atomic::Ordering::SeqCst) {
            MENU_REQUESTED.store(false, std::sync::atomic::Ordering::SeqCst);
            window.hide()?; return Ok(());
        }
        window
    } else {
        let builder = WebviewWindowBuilder::new(app, "menu-bar", WebviewUrl::App("menu-bar".into()))
            .title("Index menu bar").inner_size(420.0, 560.0).resizable(false)
            .decorations(false).shadow(true).skip_taskbar(true).always_on_top(true)
            .visible(false).focused(false)
            .initialization_script("window.__INDEX_MENU_BAR__ = true;");
        let window = crate::restrict_navigation(builder, app).build()?;
        attach_lifecycle(&window);
        window
    };
    // Reused webviews may have slept through an account event. Keep the panel
    // hidden until its session refresh and React commit acknowledge this opening.
    MENU_REQUESTED.store(true, std::sync::atomic::Ordering::SeqCst);
    let _ = window.emit("index:desktop-open", ());
    Ok(())
}
pub fn attach_lifecycle(window: &WebviewWindow) {
    #[cfg(all(target_os = "macos", not(feature = "native-smoke")))]
    {
        let handle = window.clone();
        window.on_window_event(move |event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                if handle.label() == "menu-bar" { MENU_REQUESTED.store(false, std::sync::atomic::Ordering::SeqCst); }
                if handle.label() == "main" { crate::notifications::clear_active(); }
                let _ = handle.hide();
            }
            WindowEvent::Focused(false) => {
                if handle.label() == "menu-bar" {
                    MENU_REQUESTED.store(false, std::sync::atomic::Ordering::SeqCst);
                    let _ = handle.hide();
                }
                else { crate::notifications::clear_active(); }
            }
            WindowEvent::Destroyed if handle.label() == "main" => crate::notifications::clear_active(),
            _ => {}
        });
    }
    #[cfg(any(not(target_os = "macos"), feature = "native-smoke"))]
    let _ = window;
}
fn valid_navigation(path: &str, recipient: Option<&str>) -> bool {
    if matches!(path, "/" | "/login" | "/settings") { return true; }
    path.strip_prefix("/l/").is_some_and(|id| !id.is_empty() && id.len() <= 64 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')) && recipient.is_some_and(|id| !id.is_empty())
}
#[tauri::command]
pub async fn desktop_open(app: AppHandle, path: Option<String>, recipient_id: Option<String>, expected_revision: u64) -> Result<(), String> {
    if path.as_ref().is_some_and(|path| !valid_navigation(path, recipient_id.as_deref())) { return Err("Invalid Index destination.".into()); }
    crate::session::with_revision(expected_revision, || {
        if let Some(path) = path {
            *NAVIGATION.lock().unwrap() = Some(PendingNavigation { id: NEXT_NAVIGATION.fetch_add(1, std::sync::atomic::Ordering::Relaxed), path, recipient_id });
        }
    })?;
    let handle = app.clone();
    app.run_on_main_thread(move || {
        if crate::session::visible_revision() == expected_revision { let _ = show_main(&handle); }
    }).map_err(|_| "Could not open Index.".into())
}
#[tauri::command]
pub async fn desktop_take_navigation(window: WebviewWindow, ack: Option<u64>, expected_revision: u64) -> Result<Option<PendingNavigation>, String> {
    if window.label() != "main" { return Err("Only the main window handles Index destinations.".into()); }
    crate::session::with_revision(expected_revision, || {
        let mut pending = NAVIGATION.lock().unwrap();
        if ack.is_some() && pending.as_ref().is_some_and(|item| Some(item.id) == ack) { *pending = None; }
        pending.clone()
    })
}
#[tauri::command]
pub async fn desktop_changed(window: WebviewWindow, expected_revision: u64) -> Result<(), String> {
    crate::session::check_revision(expected_revision)?;
    window.app_handle().emit("index:desktop-data", DataChanged { revision: expected_revision, source: window.label().into() }).map_err(|_| "Could not refresh Index windows.".into())
}
pub fn hide_on_session_change(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("menu-bar") {
        MENU_REQUESTED.store(false, std::sync::atomic::Ordering::SeqCst);
        let handle = window.clone();
        let _ = window.run_on_main_thread(move || { let _ = handle.hide(); });
    }
}
/// Called after the UI has checked its session and committed safe content.
#[tauri::command]
pub async fn desktop_panel_ready(window: WebviewWindow, expected_revision: u64) -> Result<(), String> {
    if window.label() != "menu-bar" { return Err("Only the menu panel can be presented.".into()); }
    crate::session::check_revision(expected_revision)?;
    #[cfg(target_os = "macos")]
    {
        let handle = window.clone();
        window.run_on_main_thread(move || {
            if MENU_REQUESTED.load(std::sync::atomic::Ordering::SeqCst) && crate::session::visible_revision() == expected_revision {
                if let Ok(pointer) = handle.ns_window() { unsafe { os::index_menu_present(pointer); } }
            }
        }).map_err(|_| "Could not show the menu panel.".to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub fn desktop_hide(window: WebviewWindow) -> Result<(), String> {
    if window.label() == "menu-bar" { MENU_REQUESTED.store(false, std::sync::atomic::Ordering::SeqCst); }
    if window.label() == "main" { crate::notifications::clear_active(); }
    window.hide().map_err(|_| "Could not hide this window.".into())
}
#[tauri::command]
pub fn desktop_quit(app: AppHandle) { app.exit(0); }
#[tauri::command]
pub fn desktop_window(window: WebviewWindow) -> String { window.label().into() }
#[tauri::command]
pub async fn launch_at_login_status() -> LoginStatus {
    #[cfg(all(target_os = "macos", not(feature = "native-smoke")))]
    { return login_status(unsafe { os::index_login_status() }); }
    #[cfg(any(not(target_os = "macos"), feature = "native-smoke"))]
    login_status(-1)
}
#[tauri::command]
pub async fn launch_at_login_set(enabled: bool) -> Result<LoginStatus, String> {
    #[cfg(all(target_os = "macos", not(feature = "native-smoke")))]
    {
        let result = unsafe { os::index_login_set(enabled) };
        return if result == -2 { Err("Could not update Launch at login. Check Login Items in System Settings.".into()) } else { Ok(login_status(result)) };
    }
    #[cfg(any(not(target_os = "macos"), feature = "native-smoke"))]
    { let _ = enabled; Ok(login_status(-1)) }
}
#[tauri::command]
pub fn launch_at_login_settings() {
    #[cfg(all(target_os = "macos", not(feature = "native-smoke")))]
    unsafe { os::index_login_settings(); }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn navigation_only_accepts_app_paths_and_account_bound_link_references() {
        assert!(valid_navigation("/l/abc_123", Some("recipient")));
        assert!(valid_navigation("/login", None));
        for path in ["https://example.com", "//example.com", "/l/../settings", "/l/a?token=x", "/l/a%2Fb", "/menu-bar"] { assert!(!valid_navigation(path, Some("recipient"))); }
        assert!(!valid_navigation("/l/abc", None));
    }
    #[test]
    fn login_items_reflect_approval_and_support_without_assuming_enabled() {
        assert_eq!(login_status(0).state, "off");
        assert_eq!(login_status(2).state, "requires-approval");
        assert_eq!(login_status(3).state, "not-found");
        assert!(!login_status(-1).supported);
    }
}
