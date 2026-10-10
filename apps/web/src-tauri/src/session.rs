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

use std::sync::{Mutex, OnceLock};
use serde::Serialize;
use tauri::{Emitter, WebviewWindow};
use crate::session_revision::Revision;

static VISIBLE_REVISION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static REVISION: Mutex<Revision> = Mutex::new(Revision::new());
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
pub fn init(app: tauri::AppHandle) { let _ = APP.set(app); }
#[derive(Serialize)]
pub struct Snapshot { token: Option<String>, revision: u64 }
#[derive(Clone, Serialize)]
struct Changed { revision: u64, source: Option<String> }
pub fn visible_revision() -> u64 { VISIBLE_REVISION.load(std::sync::atomic::Ordering::SeqCst) }
fn changed(revision: u64, source: Option<String>) {
    VISIBLE_REVISION.store(revision, std::sync::atomic::Ordering::SeqCst);
    if let Some(app) = APP.get() {
        crate::menu_bar::hide_on_session_change(app);
        let _ = app.emit("index:desktop-session", Changed { revision, source });
    }
}
fn read() -> Result<Option<String>, String> {
    #[cfg(all(target_os = "macos", not(feature = "native-smoke")))]
    if shared_session::enabled() { return shared_session::read(); }
    match entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(Error::NoEntry) => Ok(None),
        Err(_) => Err("Could not read the saved session. Unlock your credential store and try again.".into()),
    }
}
fn write(token: Option<String>) -> Result<(), String> {
    // Synchronous invalidation precedes erasure, including failed secure-store writes.
    if token.is_none() { crate::notifications::invalidate(); }
    #[cfg(all(target_os = "macos", not(feature = "native-smoke")))]
    if shared_session::enabled() { return shared_session::write(token); }
    let entry = entry()?;
    let result = match token {
        Some(token) => entry.set_password(&token),
        None => entry.delete_credential(),
    };
    match result {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(_) => Err("Could not update your secure session. Unlock your credential store and try again.".into()),
    }
}
#[tauri::command]
pub async fn session_read() -> Result<Option<String>, String> {
    Ok(session_snapshot().await?.token)
}
#[tauri::command]
pub async fn session_snapshot() -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let revision = REVISION.lock().unwrap();
        Ok(Snapshot { token: read()?, revision: revision.current() })
    }).await.map_err(|_| "The credential operation was interrupted.".to_string())?
}
#[tauri::command]
pub async fn session_revision() -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(|| REVISION.lock().unwrap().current())
        .await.map_err(|_| "The credential operation was interrupted.".to_string())
}
pub fn check_revision(expected: u64) -> Result<(), String> { with_revision(expected, || ()) }
/// A native state mutation must be atomic with respect to credential replacement.
/// Lock order is always session then notification runtime, never the reverse.
pub fn with_revision<T>(expected: u64, operation: impl FnOnce() -> T) -> Result<T, String> {
    let revision = REVISION.lock().unwrap();
    revision.apply(expected, operation)
}
async fn update(token: Option<String>, expected: Option<u64>, source: Option<String>) -> Result<u64, String> {
    if token.as_ref().is_some_and(|value| value.is_empty() || value.len() > 8192) {
        return Err("Invalid session credential.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        // All windows, legacy callers and background readers share this lock. A held
        // Keychain operation completes before any newer session can be accepted.
        let mut revision = REVISION.lock().unwrap();
        if let Some(expected) = expected { revision.check(expected)?; }
        if token.is_some() && read()? == token { return Ok(revision.current()); }
        let result = write(token);
        let next = revision.advance();
        // Also drop displayed content when the Keychain fails; never claim sign-out succeeded.
        changed(next, source);
        result.map(|()| next)
    }).await.map_err(|_| "The credential operation was interrupted.".to_string())?
}
/// Retained for native callers and smoke tooling; new webviews use compare/write.
#[tauri::command]
pub async fn session_write(token: Option<String>) -> Result<(), String> {
    update(token, None, None).await.map(|_| ())
}
#[tauri::command]
pub async fn session_compare_write(window: WebviewWindow, token: Option<String>, expected_revision: u64) -> Result<u64, String> {
    update(token, Some(expected_revision), Some(window.label().into())).await
}
/// Verification/security changes can change access without rotating the bearer credential.
#[tauri::command]
pub async fn session_touch(window: WebviewWindow, expected_revision: u64, invalidate_notifications: Option<bool>) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut revision = REVISION.lock().unwrap();
        revision.check(expected_revision)?;
        if invalidate_notifications == Some(true) { crate::notifications::invalidate(); }
        let next = revision.advance();
        changed(next, Some(window.label().into()));
        Ok(next)
    }).await.map_err(|_| "The credential operation was interrupted.".to_string())?
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
