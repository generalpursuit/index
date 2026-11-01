//! Index's menus in the macOS menu bar: the system defaults, with Settings… where Mac apps have it.
//! Windows and Linux windows have no menu bar; the page itself opens Settings on Ctrl+, there.
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Wry};

const SETTINGS: &str = "settings";

pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::default(app)?;
    if let Some(index) = menu.items()?.first().and_then(|item| item.as_submenu().cloned()) {
        // In its own section after About Index.
        let settings = MenuItem::with_id(app, SETTINGS, "Settings…", true, Some("CmdOrCtrl+,"))?;
        index.insert_items(&[&settings, &PredefinedMenuItem::separator(app)?], 2)?;
    }
    Ok(menu)
}

pub fn handle(app: &AppHandle, event: MenuEvent) {
    if event.id() == SETTINGS { let _ = crate::menu_bar::open_main_at(app, "/settings"); }
}
