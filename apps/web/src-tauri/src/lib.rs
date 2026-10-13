mod notifications;
mod menu_bar;
mod session_revision;
mod appearance;
mod app_icon;
mod titlebar;
mod session;
mod updates;
#[cfg(feature = "native-smoke")]
mod smoke;

use tauri::{Url, WebviewWindowBuilder, webview::NewWindowResponse};
use tauri_plugin_opener::OpenerExt;

fn is_website(url: &Url) -> bool {
    matches!(url.scheme(), "https" | "http")
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
}

#[tauri::command]
fn open_website(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let url = Url::parse(&url).map_err(|_| "Invalid website address.".to_string())?;
    if !is_website(&url) {
        return Err("Only HTTP and HTTPS websites can be opened.".into());
    }
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|_| "Could not open the default browser.".into())
}

fn internal_navigation(url: &Url, development: Option<&Url>) -> bool {
    if cfg!(debug_assertions) && development.is_some_and(|base| base.origin() == url.origin()) {
        return true;
    }
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"))
}

fn restrict_navigation<'a>(builder: WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle>, app: &tauri::AppHandle) -> WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle> {
    let navigation_app = app.clone();
    let popup_app = app.clone();
    let development = app.config().build.dev_url.clone();
    builder.on_navigation(move |url| {
        if internal_navigation(url, development.as_ref()) { return true; }
        if is_website(url) { let _ = navigation_app.opener().open_url(url.as_str(), None::<&str>); }
        false
    }).on_new_window(move |url, _| {
        if is_website(&url) { let _ = popup_app.opener().open_url(url.as_str(), None::<&str>); }
        NewWindowResponse::Deny
    })
}

pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(feature = "native-smoke")]
    let builder = builder.plugin(smoke::plugin());
    #[cfg(feature = "native-smoke")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        updates::desktop_release_info,
        updates::desktop_check_update,
        updates::desktop_restart_to_update,
        notifications::notification_status,
        notifications::notification_start,
        notifications::notification_stop,
        notifications::notification_active,
        notifications::notification_take_click,
        session::session_snapshot,
        session::session_revision,
        session::session_compare_write,
        session::session_touch,
        menu_bar::desktop_open,
        menu_bar::desktop_take_navigation,
        menu_bar::desktop_changed,
        menu_bar::desktop_hide,
        menu_bar::desktop_panel_ready,
        menu_bar::desktop_panel_resize,
        menu_bar::desktop_quit,
        menu_bar::desktop_window,
        menu_bar::launch_at_login_status,
        menu_bar::launch_at_login_set,
        menu_bar::launch_at_login_settings,
        session::session_read,
        session::session_write,
        open_website,
        appearance::set_appearance,
        app_icon::app_icon_status,
        app_icon::set_app_icon,
        smoke::smoke_complete,
        smoke::smoke_resize,
        smoke::smoke_icon_matches,
        smoke::smoke_progress
    ]);
    #[cfg(not(feature = "native-smoke"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        updates::desktop_release_info,
        updates::desktop_check_update,
        updates::desktop_restart_to_update,
        notifications::notification_status,
        notifications::notification_start,
        notifications::notification_stop,
        notifications::notification_active,
        notifications::notification_take_click,
        session::session_snapshot,
        session::session_revision,
        session::session_compare_write,
        session::session_touch,
        menu_bar::desktop_open,
        menu_bar::desktop_take_navigation,
        menu_bar::desktop_changed,
        menu_bar::desktop_hide,
        menu_bar::desktop_panel_ready,
        menu_bar::desktop_panel_resize,
        menu_bar::desktop_quit,
        menu_bar::desktop_window,
        menu_bar::launch_at_login_status,
        menu_bar::launch_at_login_set,
        menu_bar::launch_at_login_settings,
        session::session_read,
        session::session_write,
        open_website,
        appearance::set_appearance,
        app_icon::app_icon_status,
        app_icon::set_app_icon
    ]);
    builder
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if app.config().plugins.0.contains_key("updater") {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            session::init(app.handle().clone());
            if !menu_bar::init(app.handle())? { app.handle().exit(0); return Ok(()); }
            updates::init(app.handle());
            app_icon::restore();
            notifications::init();
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            menu_bar::ensure_main(app.handle())?;
            // A failure here leaves the first click to build the panel.
            #[cfg(all(target_os = "macos", not(feature = "native-smoke")))]
            let _ = menu_bar::ensure_panel(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Index")
        .run(|app, event| match event {
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => { let _ = menu_bar::show_main(app); }
            // Closing a macOS window is intercepted by its lifecycle handler; Quit
            // (including Command-Q) exits normally and retains device opt-in.
            tauri::RunEvent::Exit => {
                notifications::shutdown();
                updates::exit(app);
            }
            _ => { let _ = app; }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_websites_open_externally() {
        assert!(is_website(&Url::parse("https://example.com/read").unwrap()));
        assert!(!is_website(&Url::parse("file:///etc/passwd").unwrap()));
        assert!(!is_website(
            &Url::parse("https://user:password@example.com").unwrap()
        ));
    }
    #[test]
    fn remote_pages_cannot_replace_the_app() {
        assert!(internal_navigation(
            &Url::parse("tauri://localhost/people/123").unwrap(),
            None
        ));
        assert!(!internal_navigation(
            &Url::parse("https://evil.example").unwrap(),
            None
        ));
        assert!(!internal_navigation(
            &Url::parse("https://tauri.localhost.evil.example").unwrap(),
            None
        ));
    }
}
