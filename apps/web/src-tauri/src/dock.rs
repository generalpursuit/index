//! Whether Index appears in the Dock and app switcher, or only in the menu bar. The native store
//! owns this device preference; restore it before opening any windows.
use serde::Serialize;

#[derive(Serialize)]
pub struct DockStatus {
    supported: bool,
    visible: bool,
}

#[cfg(target_os = "macos")]
mod macos {
    unsafe extern "C" {
        pub fn index_dock_visible() -> bool;
        pub fn index_dock_show(visible: bool, persist: bool) -> bool;
        pub fn index_dock_restore() -> bool;
    }
}

pub fn restore() {
    #[cfg(target_os = "macos")]
    if !unsafe { macos::index_dock_restore() } {
        log::warn!("Could not restore the Dock preference.");
    }
}

#[tauri::command]
pub fn dock_status() -> DockStatus {
    #[cfg(target_os = "macos")]
    return DockStatus { supported: true, visible: unsafe { macos::index_dock_visible() } };
    #[cfg(not(target_os = "macos"))]
    DockStatus { supported: false, visible: true }
}

#[tauri::command]
pub async fn set_dock_visible(visible: bool) -> Result<DockStatus, String> {
    #[cfg(target_os = "macos")]
    {
        // The native bridge synchronously marshals AppKit work to the main thread.
        // It writes the preference only after AppKit accepted the change.
        if !unsafe { macos::index_dock_show(visible, true) } {
            return Err("Could not change the Dock setting. Please try again.".into());
        }
        // A returning Dock tile can start from the bundle's icon; show the saved choice again.
        if visible { crate::app_icon::restore(); }
        Ok(dock_status())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = visible;
        Err("Hiding the Dock icon is not supported on this platform.".into())
    }
}
