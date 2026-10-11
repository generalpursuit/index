use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

static INSTALLING: AtomicBool = AtomicBool::new(false);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    channel: &'static str,
    version: String,
    updates_enabled: bool,
}

#[derive(Serialize)]
pub struct AvailableUpdate {
    version: String,
}

fn enabled(app: &AppHandle) -> bool {
    #[cfg(target_os = "linux")]
    if app.env().appimage.is_none() { return false; }
    app.config().plugins.0.contains_key("updater")
}

fn updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    app.updater_builder().timeout(std::time::Duration::from_secs(30)).build()
        .map_err(|_| "Updates are not configured for this build.".into())
}

#[tauri::command]
pub fn desktop_release_info(app: AppHandle) -> ReleaseInfo {
    ReleaseInfo {
        channel: env!("INDEX_DESKTOP_CHANNEL"),
        version: app.package_info().version.to_string(),
        updates_enabled: enabled(&app),
    }
}

#[tauri::command]
pub async fn desktop_check_update(app: AppHandle) -> Result<Option<AvailableUpdate>, String> {
    if !enabled(&app) { return Ok(None); }
    let updater = updater(&app)?;
    let update = updater.check().await.map_err(|_| "Could not check for updates. Please try again later.")?;
    Ok(update.map(|value| AvailableUpdate { version: value.version }))
}

struct InstallGuard;
impl Drop for InstallGuard {
    fn drop(&mut self) { INSTALLING.store(false, Ordering::SeqCst); }
}

#[tauri::command]
pub async fn desktop_install_update(app: AppHandle, version: String) -> Result<(), String> {
    if !enabled(&app) { return Err("Updates are not configured for this build.".into()); }
    if INSTALLING.swap(true, Ordering::SeqCst) { return Err("An update is already installing.".into()); }
    let _guard = InstallGuard;
    // Resolve only the channel compiled into this app. Renderer input is never a URL/key.
    let update = updater(&app)?
        .check().await.map_err(|_| "Could not check for updates.")?
        .ok_or("This update is no longer available. Check again.")?;
    if update.version != version { return Err("A different update is available. Check again before installing.".into()); }
    let progress = app.clone();
    let mut downloaded = 0u64;
    update.download_and_install(move |chunk, total| {
        downloaded += chunk as u64;
        if let Some(total) = total.filter(|total| *total > 0) {
            let percent = (downloaded.saturating_mul(100) / total).min(100);
            let _ = progress.emit("index:update-progress", percent);
        }
    }, || {}).await.map_err(|_| "The update could not be verified or installed. Please try again.")?;
    app.restart();
}
