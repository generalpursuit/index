use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, async_runtime::Mutex};
use tauri_plugin_updater::UpdaterExt;

const CHECK_INTERVAL: Duration = Duration::from_secs(60 * 60);

/// Updates download and install silently in the background and apply on the next launch,
/// so the API only has to support recent releases. Windows cannot replace a running app:
/// it keeps the verified installer and runs it as the app exits.
#[derive(Default)]
pub struct Updates {
    /// Serializes background and requested checks; held across network calls.
    checking: Mutex<()>,
    ready: std::sync::Mutex<Option<Ready>>,
    #[cfg(windows)]
    relaunch: std::sync::atomic::AtomicBool,
}

struct Ready {
    version: String,
    #[cfg(windows)]
    installer: (tauri_plugin_updater::Update, Vec<u8>),
}

impl Updates {
    fn ready_version(&self) -> Option<String> {
        self.ready.lock().unwrap().as_ref().map(|ready| ready.version.clone())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    channel: &'static str,
    version: String,
    updates_enabled: bool,
    ready_version: Option<String>,
}

fn enabled(app: &AppHandle) -> bool {
    #[cfg(target_os = "linux")]
    if app.env().appimage.is_none() { return false; }
    app.config().plugins.0.contains_key("updater")
}

fn updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    app.updater_builder().timeout(Duration::from_secs(30)).build()
        .map_err(|_| "Updates are not configured for this build.".into())
}

/// Check at launch and hourly. Call after the updater plugin is registered.
pub fn init(app: &AppHandle) {
    app.manage(Updates::default());
    if !enabled(app) { return; }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let _ = prepare(&app).await;
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    });
}

/// Download, verify and install the channel's newest release unless it is already waiting.
/// Returns the version that applies on the next launch, if any.
async fn prepare(app: &AppHandle) -> Result<Option<String>, String> {
    let updates = app.state::<Updates>();
    let _checking = updates.checking.lock().await;
    // Resolve only the channel compiled into this app. Renderer input is never a URL/key.
    let Some(update) = updater(app)?.check().await
        .map_err(|_| "Could not check for updates. Please try again later.")? else {
        return Ok(updates.ready_version());
    };
    if updates.ready_version().as_ref() == Some(&update.version) { return Ok(Some(update.version)); }
    let bytes = update.download(|_, _| {}, || {}).await
        .map_err(|_| "The update could not be downloaded or verified. Please try again later.")?;
    #[cfg(not(windows))]
    update.install(&bytes).map_err(|_| "The update could not be installed. Please try again later.")?;
    let version = update.version.clone();
    *updates.ready.lock().unwrap() = Some(Ready {
        version: version.clone(),
        #[cfg(windows)]
        installer: (update, bytes),
    });
    let _ = app.emit("index:update-ready", &version);
    Ok(Some(version))
}

/// Runs as the app exits. Only Windows has an installer left to run; it relaunches the
/// app only for a requested restart.
pub fn exit(app: &AppHandle) {
    #[cfg(windows)]
    if let Some(updates) = app.try_state::<Updates>() {
        let relaunch = updates.relaunch.load(std::sync::atomic::Ordering::SeqCst);
        if let Some(Ready { installer: (update, bytes), .. }) = updates.ready.lock().unwrap().take() {
            // The quiet installer exits this process itself.
            let _ = update.restart_after_install(relaunch).install(bytes);
        }
    }
    #[cfg(not(windows))]
    let _ = app;
}

#[tauri::command]
pub fn desktop_release_info(app: AppHandle) -> ReleaseInfo {
    ReleaseInfo {
        channel: env!("INDEX_DESKTOP_CHANNEL"),
        version: app.package_info().version.to_string(),
        updates_enabled: enabled(&app),
        ready_version: app.state::<Updates>().ready_version(),
    }
}

#[tauri::command]
pub async fn desktop_check_update(app: AppHandle) -> Result<Option<String>, String> {
    if !enabled(&app) { return Ok(None); }
    prepare(&app).await
}

/// Restart into the newest release, preparing it first when none is waiting.
#[tauri::command]
pub async fn desktop_restart_to_update(app: AppHandle) -> Result<(), String> {
    if !enabled(&app) { return Err("Updates are not configured for this build.".into()); }
    if prepare(&app).await?.is_none() {
        return Err("The required update isn’t available yet. Please try again later.".into());
    }
    #[cfg(windows)]
    app.state::<Updates>().relaunch.store(true, std::sync::atomic::Ordering::SeqCst);
    app.restart();
}
