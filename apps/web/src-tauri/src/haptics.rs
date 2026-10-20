//! Trackpad detents for the page's drags, such as stepping through weeks. Only macOS has them.

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn index_haptic(strong: bool);
}

/// `strong` marks a boundary, such as a new month, rather than an ordinary step.
#[tauri::command]
pub fn desktop_haptic(strong: bool) {
    #[cfg(target_os = "macos")]
    unsafe { index_haptic(strong) };
    #[cfg(not(target_os = "macos"))]
    let _ = strong;
}
