use keyring::{Entry, Error};
#[cfg(all(target_os = "macos", not(feature = "native-smoke")))]
#[path = "shared_session.rs"]
mod shared_session;

fn entry() -> Result<Entry, String> {
    // Different backends never share a session, including local and release builds.
    #[cfg(feature = "native-smoke")]
    let service = "com.generalpursuit.index.native-smoke";
    #[cfg(not(feature = "native-smoke"))]
    let service = "com.generalpursuit.index";
    Entry::new(service, env!("INDEX_API_SERVER")).map_err(|_| {
        "Could not access the system credential store. Unlock it and try again.".into()
    })
}

#[tauri::command]
pub async fn session_read() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(all(target_os = "macos", not(feature = "native-smoke")))]
        if shared_session::enabled() { return shared_session::read(); }
        match entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(Error::NoEntry) => Ok(None),
        Err(_) => Err(
            "Could not read the saved session. Unlock your credential store and try again.".into(),
        ),
    }})
    .await
    .map_err(|_| "The credential operation was interrupted.".to_string())?
}

#[tauri::command]
pub async fn session_write(token: Option<String>) -> Result<(), String> {
    if token
        .as_ref()
        .is_some_and(|value| value.is_empty() || value.len() > 8192)
    {
        return Err("Invalid session credential.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(all(target_os = "macos", not(feature = "native-smoke")))]
        if shared_session::enabled() { return shared_session::write(token); }
        let entry = entry()?;
        let result = match token {
            Some(token) => entry.set_password(&token),
            None => entry.delete_credential(),
        };
        match result {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(_) => Err(
                "Could not update your secure session. Unlock your credential store and try again."
                    .into(),
            ),
        }
    })
    .await
    .map_err(|_| "The credential operation was interrupted.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires an unlocked OS credential store"]
    fn system_credential_round_trip() {
        let account = format!("smoke-{}", std::process::id());
        eprintln!("Creating isolated test credential");
        let entry = Entry::new("com.generalpursuit.index.tests", &account).unwrap();
        eprintln!("Writing test credential");
        entry.set_password("test-only.signed-token").unwrap();
        let restored = Entry::new("com.generalpursuit.index.tests", &account).unwrap();
        assert_eq!(restored.get_password().unwrap(), "test-only.signed-token");
        restored.delete_credential().unwrap();
        assert!(matches!(entry.get_password(), Err(Error::NoEntry)));
    }
}

// Device appearance has its own shared item; credential APIs and notification readers are unchanged.
pub(crate) fn share_appearance(preference: &str) {
    #[cfg(all(target_os = "macos", not(feature = "native-smoke")))]
    if shared_session::enabled() { shared_session::share_appearance(preference); }
    #[cfg(not(all(target_os = "macos", not(feature = "native-smoke"))))]
    let _ = preference;
}
