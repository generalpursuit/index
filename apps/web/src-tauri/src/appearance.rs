use tauri::{window::Color, AppHandle, Manager, Theme, WebviewWindow};

fn window_theme(preference: &str) -> Result<Option<Theme>, String> {
    match preference {
        "system" => Ok(None),
        "light" => Ok(Some(Theme::Light)),
        "dark" => Ok(Some(Theme::Dark)),
        _ => Err("Unknown appearance preference.".into()),
    }
}

fn background(resolved: &str) -> Result<Color, String> {
    match resolved {
        "light" => Ok(Color(255, 255, 255, 255)),
        "dark" => Ok(Color(0, 0, 0, 255)),
        _ => Err("Unknown resolved appearance.".into()),
    }
}

fn stored_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("appearance"))
}

/// The last preference the WebView reported, so a new window starts in its final chrome
/// instead of the default window background, which shows until the WebView first paints
/// and while it catches up with a native resize.
pub fn stored_theme(app: &AppHandle) -> Option<Theme> {
    let preference = std::fs::read_to_string(stored_path(app)?).ok()?;
    window_theme(&preference).ok().flatten()
}

/// Paint a window built hidden with `stored_theme` before it is first shown.
pub fn paint_background(window: &WebviewWindow) {
    let resolved = match window.theme() {
        Ok(Theme::Dark) => "dark",
        _ => "light",
    };
    if let Ok(color) = background(resolved) {
        let _ = window.as_ref().window().set_background_color(Some(color));
    }
}

fn remember(app: &AppHandle, preference: &str) {
    let Some(path) = stored_path(app) else { return };
    if std::fs::read_to_string(&path).is_ok_and(|stored| stored == preference) { return; }
    if let Some(dir) = path.parent() { let _ = std::fs::create_dir_all(dir); }
    let _ = std::fs::write(path, preference);
}

/// The WebView's local store owns the preference; no account/session data is involved.
/// None restores OS appearance, including macOS titlebar, menus and native dialogs.
#[tauri::command]
pub fn set_appearance(
    window: WebviewWindow,
    preference: String,
    resolved: String,
) -> Result<(), String> {
    let theme = window_theme(&preference)?;
    let color = background(&resolved)?;
    window
        .set_theme(theme)
        .map_err(|_| "Could not update window appearance.".to_string())?;
    // Set the native window layer. macOS does not implement WebView background color;
    // the pre-paint bootstrap and semantic body background cover the WebView itself.
    // The menu panel stays transparent: its glass material follows the theme set above.
    if window.label() != "menu-bar" {
        window
            .as_ref()
            .window()
            .set_background_color(Some(color))
            .map_err(|_| "Could not update window background.".to_string())?;
    }
    remember(window.app_handle(), &preference);
    crate::session::share_appearance(&preference);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn system_restores_native_appearance_and_explicit_choices_are_validated() {
        assert_eq!(window_theme("system").unwrap(), None);
        assert_eq!(window_theme("light").unwrap(), Some(Theme::Light));
        assert_eq!(window_theme("dark").unwrap(), Some(Theme::Dark));
        assert!(window_theme("unknown").is_err());
        assert!(background("system").is_err());
        assert_eq!(background("light").unwrap(), Color(255, 255, 255, 255));
        assert_eq!(background("dark").unwrap(), Color(0, 0, 0, 255));
    }
}
