//! Process-owned delivery runtime. Window hiding must not stop this task.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::Manager;

#[cfg(all(target_os = "macos", not(feature = "native-smoke"), not(test)))]
mod os {
    use std::ffi::{CStr, CString, c_char};
    unsafe extern "C" {
        fn index_notifications_init();
        fn index_notifications_permission(request: bool) -> i32;
        fn index_notifications_epoch() -> u64;
        fn index_notifications_show(json: *const c_char, epoch: u64) -> i32;
        fn index_notifications_clear(clear_click: bool);
        fn index_notifications_click(ack: *const c_char) -> *mut c_char;
        fn index_notifications_identity(api: *const c_char) -> *mut c_char;
        fn index_notifications_optin(api: *const c_char, value: *const c_char) -> *mut c_char;
        fn index_notifications_free(value: *mut c_char);
        fn index_notifications_request(api: *const c_char, token: *const c_char, path: *const c_char, json: *const c_char) -> *mut c_char;
        fn index_notifications_socket_open(url: *const c_char, generation: u64);
        fn index_notifications_socket_close(generation: u64);
        fn index_notifications_socket_wait(generation: u64) -> *mut c_char;
        fn index_notifications_socket_send(generation: u64, message: *const c_char);
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
    pub fn connect(url: &str, generation: u64) { if let Ok(url) = CString::new(url) { unsafe { index_notifications_socket_open(url.as_ptr(), generation); } } }
    pub fn disconnect(generation: u64) { unsafe { index_notifications_socket_close(generation); } }
    pub fn receive(generation: u64) -> String { string(unsafe { index_notifications_socket_wait(generation) }).unwrap_or_else(|| "closed".into()) }
    pub fn send(generation: u64, message: &str) { if let Ok(message) = CString::new(message) { unsafe { index_notifications_socket_send(generation, message.as_ptr()); } } }
    pub fn init() { unsafe { index_notifications_init(); } }
    pub fn permission(request: bool) -> i32 { unsafe { index_notifications_permission(request) } }
    pub fn epoch() -> u64 { unsafe { index_notifications_epoch() } }
    pub fn show(value: &str, epoch: u64) -> bool { CString::new(value).ok().is_some_and(|s| unsafe { index_notifications_show(s.as_ptr(), epoch) == 1 }) }
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
#[cfg(any(not(target_os = "macos"), feature = "native-smoke", test))]
mod os {
    use std::sync::atomic::{AtomicU64, Ordering};
    static EPOCH: AtomicU64 = AtomicU64::new(0);
    pub fn request(_: &str, _: &str, _: Option<&str>) -> Option<String> { None }
    pub fn connect(_: &str, _: u64) {}
    pub fn disconnect(_: u64) {}
    pub fn receive(_: u64) -> String { "closed".into() }
    pub fn send(_: u64, _: &str) {}
    pub fn init() {}
    pub fn permission(_: bool) -> i32 { -1 }
    pub fn epoch() -> u64 { EPOCH.load(Ordering::SeqCst) }
    pub fn show(_: &str, expected: u64) -> bool { cfg!(test) && expected == epoch() }
    pub fn clear() { EPOCH.fetch_add(1, Ordering::SeqCst); }
    pub fn clear_click() { clear(); }
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
// All transitions and epoch capture share the runtime lock. Never acquire the
// session lock here: window commands already hold session -> runtime in that order.
fn advance(state: &mut Runtime) -> u64 {
    os::disconnect(state.generation);
    state.generation += 1; state.binding = None; state.active = None;
    os::clear();
    state.generation
}
fn display_epoch(generation: u64) -> Option<u64> {
    let state = runtime().lock().unwrap();
    (state.generation == generation).then(os::epoch)
}
fn invalidate_locked(state: &mut Runtime) {
    advance(state);
    #[cfg(not(test))]
    { os::optin(Some("")); }
}
fn invalidate_if_current(generation: u64) {
    let mut state = runtime().lock().unwrap();
    if state.generation == generation { invalidate_locked(&mut state); }
}
/// Process exit stops delivery but does not opt the device out on its next launch.
pub fn shutdown() { advance(&mut runtime().lock().unwrap()); }
/// Called synchronously before session storage is erased/replaced.
pub fn invalidate() { invalidate_locked(&mut runtime().lock().unwrap()); }
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
pub async fn notification_status(app: tauri::AppHandle, expected_revision: u64) -> Result<DeviceStatus, String> {
    crate::session::check_revision(expected_revision)?;
    let allowed = permission(false).await;
    if allowed == 1 { let _ = stop(None, expected_revision).await; }
    crate::session::check_revision(expected_revision)?;
    let needs_start = runtime().lock().unwrap().binding.is_none();
    if allowed >= 2 && needs_start {
        if let Some(account) = os::optin(None) { let _ = start(app, account, false, expected_revision).await; }
    }
    crate::session::check_revision(expected_revision)?;
    let registered = runtime().lock().unwrap().binding.is_some() && allowed >= 2;
    Ok(DeviceStatus { permission: match allowed { 0 => "default", 1 => "denied", 2 | 3 => "granted", _ => "unsupported" }, registered, supported: allowed >= 0 })
}
#[tauri::command]
pub async fn notification_start(app: tauri::AppHandle, user_id: String, expected_revision: u64) -> Result<(), String> { start(app, user_id, true, expected_revision).await }
async fn start(app: tauri::AppHandle, user_id: String, ask: bool, expected_revision: u64) -> Result<(), String> {
    crate::session::check_revision(expected_revision)?;
    let token = crate::session::session_read().await?.ok_or("Sign in to enable notifications.")?;
    check_api()?;
    let auth = request(&token, "/api/auth/get-session", None).await?;
    if auth["user"]["id"].as_str() != Some(user_id.as_str()) || auth["user"]["emailVerified"] != true { return Err("Verify your account before enabling notifications.".into()); }
    crate::session::check_revision(expected_revision)?;
    if permission(ask).await < 2 { return Err("Notifications are blocked or unsupported. Check system settings.".into()); }
    let config = request(&token, "/api/v1/me/notifications/capabilities", None).await?;
    let installation = tauri::async_runtime::spawn_blocking(os::identity).await.map_err(|_| "Secure storage unavailable.")?.ok_or("Unlock your secure storage and try again.")?;
    let binding = Binding { installation, user_id, session_id: config["sessionId"].as_str().ok_or("Invalid notification configuration.")?.into() };
    // Do not replace a runtime until the supplied user was freshly verified. The
    // session lock makes revision validation + generation change one operation.
    let generation = crate::session::with_revision(expected_revision, || {
        let mut state = runtime().lock().unwrap();
        if state.binding.as_ref().is_some_and(|old| old.user_id == binding.user_id && old.session_id == binding.session_id) { return None; }
        Some(advance(&mut state))
    })?;
    let Some(generation) = generation else { return Ok(()); };
    let mut registration = body(&binding); registration["kind"] = json!("desktop");
    request(&token, "/api/v1/me/notifications/devices", Some(registration)).await?;
    let accepted = crate::session::with_revision(expected_revision, || {
        let mut state = runtime().lock().unwrap();
        if state.generation != generation { return false; }
        os::optin(Some(binding.user_id.as_str())); state.binding = Some(binding.clone());
        true
    })?;
    if !accepted { return Err("Session changed.".into()); }
    tauri::async_runtime::spawn(run(app, binding, generation));
    Ok(())
}
#[tauri::command]
pub async fn notification_stop(preserve_click: Option<bool>, expected_revision: u64) -> Result<(), String> {
    stop(preserve_click, expected_revision).await
}
async fn stop(preserve_click: Option<bool>, expected_revision: u64) -> Result<(), String> {
    let previous = crate::session::with_revision(expected_revision, || {
        let previous = runtime().lock().unwrap().binding.clone();
        invalidate();
        if preserve_click != Some(true) { os::clear_click(); }
        previous
    })?;
    if let (Some(binding), Some(token)) = (previous, crate::session::session_read().await?) {
        let _ = request(&token, "/api/v1/me/notifications/devices/remove", Some(body(&binding))).await;
    }
    Ok(())
}
/// Native window lifecycle owns this internal cleanup independently of any webview.
pub fn clear_active() {
    let mut state = runtime().lock().unwrap(); state.active = None;
    os::send(state.generation, r#"{"type":"presence","conversationId":null}"#);
}
#[tauri::command]
pub async fn notification_active(app: tauri::AppHandle, conversation_id: Option<String>, expected_revision: u64) -> Result<(), String> {
    crate::session::with_revision(expected_revision, || { runtime().lock().unwrap().active = conversation_id; })?;
    send_presence(&app, false);
    Ok(())
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Click { id: String, path: String, recipient_id: String }
#[tauri::command]
pub async fn notification_take_click(ack: Option<String>, expected_revision: u64) -> Option<Click> {
    crate::session::check_revision(expected_revision).ok()?;
    // Routing is independent of re-enrollment. Keep an opaque click through restricted
    // sessions; only a fresh verified session of its recipient can consume it.
    let click: Click = serde_json::from_str(&os::click(None)?).ok()?;
    if !valid_path(&click.path) { let _ = crate::session::with_revision(expected_revision, || os::click(Some(&click.id))); return None; }
    let token = crate::session::session_read().await.ok()??;
    let auth = request(&token, "/api/auth/get-session", None).await.ok()?;
    if crate::session::session_read().await.ok().flatten().as_deref() != Some(token.as_str()) { return None; }
    let user_id = auth["user"]["id"].as_str()?;
    if user_id != click.recipient_id { let _ = crate::session::with_revision(expected_revision, || os::click(Some(&click.id))); return None; }
    if auth["user"]["emailVerified"] != true { return None; }
    crate::session::check_revision(expected_revision).ok()?;
    if ack.as_deref() == Some(click.id.as_str()) { let _ = crate::session::with_revision(expected_revision, || os::click(Some(&click.id))); return None; }
    Some(click)
}
fn valid_path(path: &str) -> bool {
    let parts: Vec<_> = path.split('/').collect();
    parts.len() == 3 && parts[0].is_empty() && matches!(parts[1], "messages" | "l" | "u") && !parts[2].is_empty() && parts[2].bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}
fn send_presence(app: &tauri::AppHandle, heartbeat: bool) {
    let visible = app.get_webview_window("main").is_some_and(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false));
    let state = runtime().lock().unwrap();
    let conversation = if visible { state.active.clone() } else { None };
    if heartbeat && conversation.is_none() { os::send(state.generation, "ping"); }
    else { os::send(state.generation, &json!({ "type": "presence", "conversationId": conversation }).to_string()); }
}
fn valid_socket(address: &str, user_id: &str) -> bool {
    let Ok(socket) = tauri::Url::parse(address) else { return false; };
    let Ok(api) = tauri::Url::parse(env!("INDEX_API_SERVER")) else { return false; };
    let expected = if api.scheme() == "https" { "wss" } else { "ws" };
    socket.scheme() == expected && socket.host_str() == api.host_str() && socket.port_or_known_default() == api.port_or_known_default()
      && socket.username().is_empty() && socket.password().is_none() && socket.fragment().is_none()
      && socket.path() == format!("/live/{}", user_id) && socket.query_pairs().any(|(key, value)| key == "ticket" && !value.is_empty())
}
fn handle_socket_event(event: &str, presence: impl FnOnce()) -> bool {
    // A pong acknowledges our keepalive; replying to it would create a ping/pong loop.
    if matches!(event, "timeout" | "{\"type\":\"change\"}") { presence(); }
    event == "{\"type\":\"change\"}"
}
async fn run(app: tauri::AppHandle, binding: Binding, generation: u64) {
    let mut seen = std::collections::VecDeque::<String>::new();
    let mut backoff = 2;
    let mut poll_backoff = 30;
    while current(generation) {
        let token = match crate::session::session_read().await { Ok(Some(token)) => token, _ => break };
        if permission(false).await < 2 || !current(generation) { break; }
        let ticket = match request(&token, "/api/v1/me/live/ticket", Some(json!({}))).await {
            Ok(ticket) => ticket,
            Err(error) if error == "revoked" => break,
            _ => { tokio::time::sleep(Duration::from_secs(backoff)).await; backoff = (backoff * 2).min(900); continue; }
        };
        let Some(url) = ticket["url"].as_str().filter(|url| valid_socket(url, &binding.user_id)) else { break; };
        if !current(generation) { return; }
        os::connect(url, generation);
        let mut retry_at: Option<std::time::Instant> = None;
        while current(generation) {
            let event = if retry_at.is_some_and(|at| at <= std::time::Instant::now()) {
                retry_at = None; "{\"type\":\"change\"}".to_owned()
            } else {
                tauri::async_runtime::spawn_blocking(move || os::receive(generation)).await.unwrap_or_else(|_| "closed".into())
            };
            if !current(generation) { return; }
            if event == "closed" { break; }
            if !handle_socket_event(&event, || send_presence(&app, true)) { continue; }
            backoff = 2;
            let token = match crate::session::session_read().await { Ok(Some(token)) => token, _ => return };
            let polled = request(&token, "/api/v1/me/notifications/poll", Some(body(&binding))).await;
            match polled {
                Err(error) if error == "revoked" => { invalidate_if_current(generation); return; },
                Ok(result) => {
                    poll_backoff = 30;
                    if result["hasMore"] == true || result["items"].as_array().is_some_and(|items| items.len() == 20) { retry_at = Some(std::time::Instant::now()); }
                    if let Some(seconds) = result["retryAfterSeconds"].as_u64() {
                        let deadline = std::time::Instant::now() + Duration::from_secs(seconds);
                        retry_at = Some(retry_at.map_or(deadline, |old| old.min(deadline)));
                    }
                    for item in result["items"].as_array().into_iter().flatten() {
                        if !current(generation) || crate::session::session_read().await.ok().flatten().as_deref() != Some(token.as_str()) { return; }
                        let alert = &item["alert"];
                        if alert["recipientId"].as_str() != Some(binding.user_id.as_str()) || !alert["path"].as_str().is_some_and(valid_path) { continue; }
                        let Some(id) = alert["id"].as_str() else { continue; };
                        let delivered = if seen.iter().any(|old| old == id) { true } else {
                            // Capture while this runtime owns delivery, before queueing the
                            // blocking job. A delayed job must never adopt B's new epoch.
                            let Some(epoch) = display_epoch(generation) else { return; };
                            let data = alert.to_string();
                            tauri::async_runtime::spawn_blocking(move || os::show(&data, epoch)).await.unwrap_or(false)
                        };
                        if !current(generation) { return; }
                        if delivered {
                            seen.push_back(id.into()); if seen.len() > 256 { seen.pop_front(); }
                            let mut ack = body(&binding); ack["id"] = json!(id); ack["lease"] = item["lease"].clone();
                            if request(&token, "/api/v1/me/notifications/ack", Some(ack)).await.is_err() { retry_at = Some(std::time::Instant::now() + Duration::from_secs(120)); }
                        } else {
                            retry_at = Some(std::time::Instant::now() + Duration::from_secs(120));
                        }
                    }
                }
                _ => {
                    retry_at = Some(std::time::Instant::now() + Duration::from_secs(poll_backoff));
                    poll_backoff = (poll_backoff * 2).min(900);
                }
            }
        }
        os::disconnect(generation);
        if current(generation) { tokio::time::sleep(Duration::from_secs(backoff)).await; backoff = (backoff * 2).min(900); }
    }
    invalidate_if_current(generation);
}
#[cfg(test)]
mod tests {
    use super::*;
    static TEST_RUNTIME: Mutex<()> = Mutex::new(());
    #[test] fn socket_pongs_cannot_create_a_keepalive_feedback_loop() {
        let mut incoming = std::collections::VecDeque::from(["timeout", "{\"type\":\"change\"}"]);
        let mut sent = 0;
        let mut changes = 0;
        let mut handled = 0;
        while let Some(event) = incoming.pop_front() {
            handled += 1;
            assert!(handled < 10, "keepalive replies triggered more keepalives");
            if handle_socket_event(event, || { sent += 1; incoming.push_back("pong"); }) { changes += 1; }
        }
        assert_eq!(sent, 2);
        assert_eq!(changes, 1);
    }
    #[test] fn notification_paths_cannot_escape_the_resolver() {
        assert!(valid_path("/messages/abc_123"));
        for path in ["//evil.test", "https://evil.test", "/l/a?token=b", "/u/../settings", "/l/a%2Fb"] { assert!(!valid_path(path)); }
    }
    #[test] fn hiding_main_keeps_delivery_and_quit_ends_it() {
        let _serial = TEST_RUNTIME.lock().unwrap();
        let before = {
            let mut state = runtime().lock().unwrap();
            state.binding = Some(Binding { installation: "fixture".into(), session_id: "session".into(), user_id: "account".into() });
            state.active = Some("conversation".into());
            state.generation
        };
        clear_active();
        assert!(current(before));
        assert!(runtime().lock().unwrap().binding.is_some());
        assert!(runtime().lock().unwrap().active.is_none());
        shutdown();
        assert!(!current(before));
        assert!(runtime().lock().unwrap().binding.is_none());
    }
    #[test] fn old_worker_termination_cannot_invalidate_new_runtime() {
        let _serial = TEST_RUNTIME.lock().unwrap();
        let old = runtime().lock().unwrap().generation;
        assert!(current(old)); // A passed the old check before B installed.
        let new = {
            let mut state = runtime().lock().unwrap();
            let next = advance(&mut state);
            state.binding = Some(Binding { installation: "fixture".into(), session_id: "B".into(), user_id: "B".into() });
            state.active = Some("B-conversation".into());
            next
        };
        let epoch = os::epoch();
        invalidate_if_current(old);
        assert!(current(new));
        assert_eq!(os::epoch(), epoch);
        assert_eq!(runtime().lock().unwrap().binding.as_ref().unwrap().user_id, "B");
        assert_eq!(runtime().lock().unwrap().active.as_deref(), Some("B-conversation"));
        invalidate_if_current(new);
        assert!(!current(new));
        assert!(runtime().lock().unwrap().binding.is_none());
    }
    #[test] fn queued_old_display_cannot_adopt_new_epoch_or_clear_it() {
        let _serial = TEST_RUNTIME.lock().unwrap();
        let old = runtime().lock().unwrap().generation;
        let queued_epoch = display_epoch(old).unwrap();
        let new = advance(&mut runtime().lock().unwrap());
        let new_epoch = display_epoch(new).unwrap();
        assert_ne!(queued_epoch, new_epoch);
        assert!(display_epoch(old).is_none());
        // The fake OS bridge models the passed epoch contract, not AppKit delivery.
        assert!(!os::show("old queued alert", queued_epoch));
        invalidate_if_current(old);
        assert_eq!(os::epoch(), new_epoch);
        assert!(os::show("new alert", new_epoch));
    }
    #[test] fn stopping_invalidates_old_tasks_and_presence() {
        let _serial = TEST_RUNTIME.lock().unwrap();
        let before = { let mut s = runtime().lock().unwrap(); s.active = Some("old-conversation".into()); s.generation };
        invalidate(); assert!(!current(before)); assert!(runtime().lock().unwrap().active.is_none());
    }
}
