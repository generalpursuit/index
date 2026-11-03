//! Runs only in explicitly built fixture binaries. The production build omits this module.
use tauri::{Manager, Webview, plugin::TauriPlugin, webview::PageLoadEvent};

#[tauri::command]
pub fn smoke_complete(app: tauri::AppHandle, error: Option<String>) {
    if let Some(error) = error {
        eprintln!("Native smoke failed: {error}");
        app.exit(1);
    } else {
        println!("Native smoke passed");
        app.exit(0);
    }
}

#[tauri::command]
pub fn smoke_progress(message: String) {
    println!("Native smoke: {message}");
}

/// Opens Index again as Finder or Spotlight does: LaunchServices first makes the running app a
/// regular one, with a Dock icon, then sends the reopen event. Main-thread command.
#[tauri::command]
pub fn smoke_reopen(app: tauri::AppHandle) -> bool {
    unsafe extern "C" {
        fn index_dock_show(visible: bool, persist: bool) -> bool;
    }
    if !unsafe { index_dock_show(true, false) } {
        return false;
    }
    crate::reopen(&app);
    true
}

#[tauri::command]
pub fn smoke_resize(webview: Webview, width: f64, height: f64) -> Result<(), String> {
    webview
        .window()
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|error| error.to_string())
}

pub fn plugin() -> TauriPlugin<tauri::Wry> {
    let phase = std::env::var("INDEX_NATIVE_SMOKE_PHASE").unwrap_or_default();
    assert!(
        matches!(phase.as_str(), "login" | "restore" | "signed-out" | "dock" | "dock-restore"),
        "Set INDEX_NATIVE_SMOKE_PHASE to login, restore, signed-out, dock, or dock-restore"
    );
    assert_eq!(
        env!("INDEX_API_SERVER"),
        "http://localhost:3002",
        "Native smoke only runs against the disposable fixture backend"
    );
    tauri::plugin::Builder::new("smoke")
        .setup(|app, _| {
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(60));
                eprintln!("Native smoke timed out");
                app.exit(1);
            });
            Ok(())
        })
        .on_navigation(|_, url| {
            println!("Native smoke navigating: {url}");
            true
        })
        .on_page_load(move |webview, payload| {
            println!("Native smoke page {:?}: {}", payload.event(), payload.url());
            if payload.event() == PageLoadEvent::Finished {
                let script = format!(
                    "window.__SMOKE_PHASE__ = {:?};\n{}",
                    phase,
                    include_str!("../../tests/native-smoke.js")
                );
                if let Err(error) = webview.eval(script) {
                    eprintln!("Could not start native smoke: {error}");
                    webview.app_handle().exit(1);
                }
            }
        })
        .build()
}
