//! The native store owns this device preference; restore it before opening any windows.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AppIcon {
    Ink,
    Paper,
}

#[derive(Serialize)]
pub struct IconStatus {
    supported: bool,
    icon: AppIcon,
}

#[cfg(target_os = "macos")]
mod macos {
    use super::AppIcon;

    unsafe extern "C" {
        fn index_app_icon_read() -> i32;
        fn index_app_icon_apply(bytes: *const u8, length: usize, choice: i32, persist: bool) -> bool;
    }

    pub fn read() -> AppIcon {
        match unsafe { index_app_icon_read() } {
            1 => AppIcon::Paper,
            _ => AppIcon::Ink,
        }
    }

    pub fn apply(icon: AppIcon, persist: bool) -> Result<(), String> {
        let (bytes, choice): (&[u8], i32) = match icon {
            AppIcon::Ink => (include_bytes!("../icons/macos/icon.png"), 0),
            AppIcon::Paper => (include_bytes!("../icons/macos/icon-paper.png"), 1),
        };
        if unsafe { index_app_icon_apply(bytes.as_ptr(), bytes.len(), choice, persist) } {
            Ok(())
        } else {
            Err("Could not change the Dock icon. Please try again.".into())
        }
    }
}

pub fn restore() {
    #[cfg(target_os = "macos")]
    if let Err(error) = macos::apply(macos::read(), false) {
        log::warn!("{error}");
    }
}

#[tauri::command]
pub fn app_icon_status() -> IconStatus {
    #[cfg(target_os = "macos")]
    return IconStatus { supported: true, icon: macos::read() };
    #[cfg(not(target_os = "macos"))]
    IconStatus { supported: false, icon: AppIcon::Ink }
}

#[tauri::command]
pub async fn set_app_icon(icon: AppIcon) -> Result<IconStatus, String> {
    #[cfg(target_os = "macos")]
    {
        // The native bridge synchronously marshals AppKit work to the main thread.
        // It writes the preference only after the image was successfully applied.
        macos::apply(icon, true)?;
        Ok(app_icon_status())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = icon;
        Err("App icon selection is not supported on this platform.".into())
    }
}
