use tauri::{window::Color, Theme, WebviewWindow};

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
    window
        .as_ref()
        .window()
        .set_background_color(Some(color))
        .map_err(|_| "Could not update window background.".to_string())?;
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
