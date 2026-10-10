use std::ffi::{CStr, CString, c_char};
unsafe extern "C" {
    fn index_shared_appearance(server: *const c_char, preference: *const c_char);
    fn index_shared_enabled() -> i32;
    fn index_shared_read(server: *const c_char, token: *mut *mut c_char) -> i32;
    fn index_shared_write(server: *const c_char, token: *const c_char) -> i32;
    fn index_shared_free(value: *mut c_char);
    #[cfg(test)]
    fn index_shared_scope(raw: *const c_char) -> *mut c_char;
}
pub fn enabled() -> bool { unsafe { index_shared_enabled() != 0 } }
fn error() -> String { "Could not access the shared Keychain session. Unlock the device and check signing/Keychain configuration.".into() }
pub fn read() -> Result<Option<String>, String> {
    let server = CString::new(env!("INDEX_API_SERVER")).map_err(|_| error())?;
    let mut token = std::ptr::null_mut();
    let status = unsafe { index_shared_read(server.as_ptr(), &mut token) };
    if status != 0 { return Err(error()); }
    if token.is_null() { return Ok(None); }
    let value = unsafe { CStr::from_ptr(token) }.to_str().map(str::to_owned).map_err(|_| error());
    unsafe { index_shared_free(token); }
    value.map(Some)
}
pub fn write(token: Option<String>) -> Result<(), String> {
    let server = CString::new(env!("INDEX_API_SERVER")).map_err(|_| error())?;
    let token = token.map(CString::new).transpose().map_err(|_| error())?;
    let status = unsafe { index_shared_write(server.as_ptr(), token.as_ref().map_or(std::ptr::null(), |value| value.as_ptr())) };
    if status == 0 { Ok(()) } else { Err(error()) }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_scope_matches_swift_fixtures() {
        let cases: serde_json::Value = serde_json::from_str(include_str!("../../../ios/Tests/IndexCoreTests/Fixtures/api-scopes.json")).unwrap();
        for case in cases.as_array().unwrap() {
            let raw = CString::new(case["input"].as_str().unwrap()).unwrap();
            let result = unsafe { index_shared_scope(raw.as_ptr()) };
            let actual = if result.is_null() { None } else {
                let value = unsafe { CStr::from_ptr(result) }.to_str().unwrap().to_owned();
                unsafe { index_shared_free(result); }
                Some(value)
            };
            assert_eq!(actual.as_deref(), case["output"].as_str());
        }
    }
}

pub fn share_appearance(preference: &str) {
    if let (Ok(server), Ok(value)) = (CString::new(env!("INDEX_API_SERVER")), CString::new(preference)) {
        unsafe { index_shared_appearance(server.as_ptr(), value.as_ptr()); }
    }
}
