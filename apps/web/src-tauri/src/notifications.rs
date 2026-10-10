//! Process-owned delivery runtime. Window hiding must not stop this task.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::Manager;

#[cfg(all(target_os = "macos", not(feature = "native-smoke")))]
mod os {
    use std::ffi::{CStr, CString, c_char};
    unsafe extern "C" {
        fn index_notifications_init();
        fn index_notifications_permission(request: bool) -> i32;
        fn index_notifications_show(json: *const c_char) -> i32;
        fn index_notifications_clear(clear_click: bool);
        fn index_notifications_click(ack: *const c_char) -> *mut c_char;
        fn index_notifications_identity(api: *const c_char) -> *mut c_char;
        fn index_notifications_optin(api: *const c_char, value: *const c_char) -> *mut c_char;
        fn index_notifications_free(value: *mut c_char);
        fn index_notifications_request(api: *const c_char, token: *const c_char, path: *const c_char, json: *const c_char) -> *mut c_char;
    }
    fn string(value: *mut c_char) -> Option<String> {
        if value.is_null() { return None; }
        let result = unsafe { CStr::from_ptr(value).to_str().ok().map(str::to_owned) };
        unsafe { index_notifications_free(value); }
        result
    }
    pub fn request(token: &str, path: &str, body: Option<&str>) -> Option<String> {
        let api = CString::new(env!("INDEX_API_SERVER")).ok()?;
        let token = CString::new(token).ok()?; let path = CString::new(path).ok()?;
        let body = body.and_then(|v| CString::new(v).ok());
        string(unsafe { index_notifications_request(api.as_ptr(), token.as_ptr(), path.as_ptr(), body.as_ref().map_or(std::ptr::null(), |v| v.as_ptr())) })
    }
    pub fn init() { unsafe { index_notifications_init(); } }
    pub fn permission(request: bool) -> i32 { unsafe { index_notifications_permission(request) } }
    pub fn show(value: &str) -> bool { CString::new(value).ok().is_some_and(|s| unsafe { index_notifications_show(s.as_ptr()) == 1 }) }
    pub fn clear() { unsafe { index_notifications_clear(false); } }
    pub fn clear_click() { unsafe { index_notifications_clear(true); } }
    pub fn click(ack: Option<&str>) -> Option<String> {
        let ack = ack.and_then(|s| CString::new(s).ok());
        string(unsafe { index_notifications_click(ack.as_ref().map_or(std::ptr::null(), |s| s.as_ptr())) })
    }
    pub fn identity() -> Option<String> {
        let api = CString::new(env!("INDEX_API_SERVER")).ok()?;
        string(unsafe { index_notifications_identity(api.as_ptr()) })
    }
    pub fn optin(value: Option<&str>) -> Option<String> {
        let api = CString::new(env!("INDEX_API_SERVER")).ok()?;
        let value = value.and_then(|s| CString::new(s).ok());
        string(unsafe { index_notifications_optin(api.as_ptr(), value.as_ref().map_or(std::ptr::null(), |s| s.as_ptr())) })
    }
}
#[cfg(any(not(target_os = "macos"), feature = "native-smoke"))]
mod os {
    pub fn request(_: &str, _: &str, _: Option<&str>) -> Option<String> { None }
    pub fn init() {}
    pub fn permission(_: bool) -> i32 { -1 }
    pub fn show(_: &str) -> bool { false }
    pub fn clear() {}
    pub fn clear_click() {}
    pub fn click(_: Option<&str>) -> Option<String> { None }
    pub fn identity() -> Option<String> { None }
    pub fn optin(_: Option<&str>) -> Option<String> { None }
}
#[derive(Clone)]
struct Binding { installation: String, session_id: String, user_id: String }
#[derive(Default)]
struct Runtime { generation: u64, binding: Option<Binding>, active: Option<String> }
static RUNTIME: OnceLock<Mutex<Runtime>> = OnceLock::new();
fn runtime() -> &'static Mutex<Runtime> { RUNTIME.get_or_init(|| Mutex::new(Runtime::default())) }
fn current(generation: u64) -> bool { runtime().lock().unwrap().generation == generation }
pub fn init() { os::init(); }
/// Called synchronously before session storage is erased/replaced and by menu-bar Quit.
pub fn invalidate() {
    let mut state = runtime().lock().unwrap();
    state.generation += 1; state.binding = None; state.active = None;
    #[cfg(not(test))]
    { os::optin(Some("")); os::clear(); }
}
fn body(binding: &Binding) -> Value { json!({ "installation": binding.installation, "sessionId": binding.session_id }) }
fn check_api() -> Result<(), String> {
    let url = tauri::Url::parse(env!("INDEX_API_SERVER")).map_err(|_| "Invalid notification API.")?;
    if !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() ||
      (url.scheme() != "https" && !(url.scheme() == "http" && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1")))) { return Err("Notifications require a configured HTTPS API.".into()); }
    Ok(())
}
async fn request(token: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
    check_api()?;
    let token = token.to_owned(); let path = path.to_owned(); let body = body.map(|value| value.to_string());
    let response = tauri::async_runtime::spawn_blocking(move || os::request(&token, &path, body.as_deref())).await.map_err(|_| "Notification request interrupted.")?.ok_or("Notification connection unavailable.")?;
    let value: Value = serde_json::from_str(&response).map_err(|_| "Invalid notification response.")?;
    let status = value["status"].as_u64().ok_or("Invalid notification response.")?;
    if matches!(status, 401 | 403 | 404) { return Err("revoked".into()); }
    if !(200..300).contains(&status) { return Err("Notification service unavailable.".into()); }
    Ok(value["body"].clone())
}
async fn permission(request: bool) -> i32 { tauri::async_runtime::spawn_blocking(move || os::permission(request)).await.unwrap_or(-1) }

#[derive(Serialize)]
pub struct DeviceStatus { permission: &'static str, registered: bool, supported: bool }
#[tauri::command]
pub async fn notification_status(app: tauri::AppHandle) -> DeviceStatus {
    let allowed = permission(false).await;
    if allowed == 1 { let _ = notification_stop(None).await; }
    let needs_start = runtime().lock().unwrap().binding.is_none();
    if allowed >= 2 && needs_start {
        if let account = os::optin(None) { let _ = start(app, account, false).await; }
    }
    let registered = runtime().lock().unwrap().binding.is_some() && allowed >= 2;
    DeviceStatus { permission: match allowed { 0 => "default", 1 => "denied", 2 | 3 => "granted", _ => "unsupported" }, registered, supported: cfg!(all(target_os = "macos", not(feature = "native-smoke"))) }
}
#[tauri::command]
pub async fn notification_start(app: tauri::AppHandle, user_id: String) -> Result<(), String> { start(app, user_id, true).await }
async fn start(app: tauri::AppHandle, user_id: String, ask: bool) -> Result<(), String> {
    let generation = { let mut state = runtime().lock().unwrap(); state.generation += 1; state.binding = None; state.active = None; state.generation };
    if permission(ask).await < 2 { return Err("Notifications are blocked or unsupported. Check system settings.".into()); }
    if !current(generation) { return Err("Session changed.".into()); }
    let token = crate::session::session_read().await?.ok_or("Sign in to enable notifications.")?;
    check_api()?;
    let auth = request(&token, "/api/auth/get-session", None).await?;
    if auth["user"]["id"].as_str() != Some(user_id.as_str()) || auth["user"]["emailVerified"] != true { return Err("Verify your account before enabling notifications.".into()); }
    let config = request(&token, "/api/v1/me/notifications/capabilities", None).await?;
    let installation = tauri::async_runtime::spawn_blocking(os::identity).await.map_err(|_| "Secure storage unavailable.")?.ok_or("Unlock your secure storage and try again.")?;
    let binding = Binding { installation, user_id, session_id: config["sessionId"].as_str().ok_or("Invalid notification configuration.")?.into() };
    if !current(generation) || crate::session::session_read().await?.as_deref() != Some(token.as_str()) { return Err("Session changed.".into()); }
    let mut registration = body(&binding); registration["kind"] = json!("desktop");
    request(&token, "/api/v1/me/notifications/devices", Some(registration)).await?;
    if !current(generation) || crate::session::session_read().await?.as_deref() != Some(token.as_str()) { return Err("Session changed.".into()); }
    {
        let mut state = runtime().lock().unwrap();
        if state.generation != generation { return Err("Session changed.".into()); }
        os::optin(Some(binding.user_id.as_str())); state.binding = Some(binding.clone());
    }
    tauri::async_runtime::spawn(run(app, binding, generation));
    Ok(())
}
#[tauri::command]
pub async fn notification_stop(preserve_click: Option<bool>) -> Result<(), String> {
    let previous = runtime().lock().unwrap().binding.clone();
    invalidate();
    if preserve_click != Some(true) { os::clear_click(); }
    if let (Some(binding), Some(token)) = (previous, crate::session::session_read().await?) {
        let _ = request(&token, "/api/v1/me/notifications/devices/remove", Some(body(&binding))).await;
    }
    Ok(())
}
#[tauri::command]
pub fn notification_active(conversation_id: Option<String>) {
    runtime().lock().unwrap().active = conversation_id;
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Click { id: String, path: String, recipient_id: String }
#[tauri::command]
pub async fn notification_take_click(ack: Option<String>) -> Option<Click> {
    // Routing is independent of re-enrollment. Keep an opaque click through restricted
    // sessions; only a fresh verified session of its recipient can consume it.
    let click: Click = serde_json::from_str(&os::click(None)?).ok()?;
    if !valid_path(&click.path) { os::click(Some(&click.id)); return None; }
    let token = crate::session::session_read().await.ok()??;
    let auth = request(&token, "/api/auth/get-session", None).await.ok()?;
    if crate::session::session_read().await.ok().flatten().as_deref() != Some(token.as_str()) { return None; }
    let user_id = auth["user"]["id"].as_str()?;
    if user_id != click.recipient_id { os::click(Some(&click.id)); return None; }
    if auth["user"]["emailVerified"] != true { return None; }
    if ack.as_deref() == Some(click.id.as_str()) { os::click(Some(&click.id)); return None; }
    Some(click)
}
fn valid_path(path: &str) -> bool {
    let parts: Vec<_> = path.split('/').collect();
    parts.len() == 3 && parts[0].is_empty() && matches!(parts[1], "messages" | "l" | "u") && !parts[2].is_empty() && parts[2].bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}
async fn run(app: tauri::AppHandle, binding: Binding, generation: u64) {
    let mut seen = std::collections::VecDeque::<String>::new();
    while current(generation) {
        let token = match crate::session::session_read().await { Ok(Some(token)) => token, _ => break };
        if permission(false).await < 2 { break; }
        if !current(generation) { return; }
        // Native visibility is authoritative even if the hidden webview stops running JS.
        let visible = app.get_webview_window("main").is_some_and(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false));
        let active = if visible { runtime().lock().unwrap().active.clone() } else { None };
        let mut presence = body(&binding); presence["conversationId"] = json!(active);
        let _ = request(&token, "/api/v1/me/notifications/active", Some(presence)).await;
        let polled = request(&token, "/api/v1/me/notifications/poll", Some(body(&binding))).await;
        match polled {
            Err(error) if error == "revoked" => break,
            Ok(result) => {
                for item in result["items"].as_array().into_iter().flatten() {
                    if !current(generation) || crate::session::session_read().await.ok().flatten().as_deref() != Some(token.as_str()) { return; }
                    let alert = &item["alert"];
                    if alert["recipientId"].as_str() != Some(binding.user_id.as_str()) || !alert["path"].as_str().is_some_and(valid_path) { continue; }
                    let Some(id) = alert["id"].as_str() else { continue; };
                    let delivered = if seen.iter().any(|old| old == id) { true } else {
                        let data = alert.to_string();
                        tauri::async_runtime::spawn_blocking(move || os::show(&data)).await.unwrap_or(false)
                    };
                    if !current(generation) { os::clear(); return; }
                    if delivered {
                        seen.push_back(id.into()); if seen.len() > 256 { seen.pop_front(); }
                        let mut ack = body(&binding); ack["id"] = json!(id); ack["lease"] = item["lease"].clone();
                        let _ = request(&token, "/api/v1/me/notifications/ack", Some(ack)).await;
                    }
                }
            }
            _ => {} // Network errors retain jobs for leased retry; no content logging.
        }
        tokio::time::sleep(Duration::from_secs(15)).await;
    }
    if current(generation) { invalidate(); }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn notification_paths_cannot_escape_the_resolver() {
        assert!(valid_path("/messages/abc_123"));
        for path in ["//evil.test", "https://evil.test", "/l/a?token=b", "/u/../settings", "/l/a%2Fb"] { assert!(!valid_path(path)); }
    }
    #[test] fn stopping_invalidates_old_tasks_and_presence() {
        let before = { let mut s = runtime().lock().unwrap(); s.active = Some("old-conversation".into()); s.generation };
        invalidate(); assert!(!current(before)); assert!(runtime().lock().unwrap().active.is_none());
    }
}
