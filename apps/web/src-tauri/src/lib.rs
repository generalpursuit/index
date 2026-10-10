mod appearance;
mod session;
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

pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(feature = "native-smoke")]
    let builder = builder.plugin(smoke::plugin());
    #[cfg(feature = "native-smoke")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        session::session_read,
        session::session_write,
        open_website,
        appearance::set_appearance,
        smoke::smoke_complete,
        smoke::smoke_resize,
        smoke::smoke_progress
    ]);
    #[cfg(not(feature = "native-smoke"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        session::session_read,
        session::session_write,
        open_website,
        appearance::set_appearance
    ]);
    builder
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let config = app
                .config()
                .app
                .windows
                .first()
                .expect("main window configuration");
            let navigation_app = app.handle().clone();
            let popup_app = app.handle().clone();
            let development = app.config().build.dev_url.clone();
            WebviewWindowBuilder::from_config(app, config)?
                .on_navigation(move |url| {
                    if internal_navigation(url, development.as_ref()) {
                        return true;
                    }
                    if is_website(url) {
                        let _ = navigation_app.opener().open_url(url.as_str(), None::<&str>);
                    }
                    false
                })
                .on_new_window(move |url, _| {
                    if is_website(&url) {
                        let _ = popup_app.opener().open_url(url.as_str(), None::<&str>);
                    }
                    NewWindowResponse::Deny
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Index");
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
