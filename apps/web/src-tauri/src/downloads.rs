use std::{collections::BTreeMap, path::PathBuf, sync::{Mutex, PoisonError}};
use tauri::{Runtime, Url, Webview, webview::DownloadEvent};

// Only macOS needs this: WebKit there names a free file in Downloads but reports no path when it
// finishes, so each download's destination is kept from its request until it finishes.
static DESTINATIONS: Mutex<BTreeMap<String, PathBuf>> = Mutex::new(BTreeMap::new());

/// Only `blob:` addresses may download. The scheme alone is enough: a page can only create
/// `blob:` addresses for its own origin, and `restrict_navigation` keeps remote pages out of
/// the window, so every such address is the app's own.
fn may_download(url: &Url) -> bool { url.scheme() == "blob" }

/// Files saved from a conversation go to Downloads under a free name and are shown in the
/// file manager. Without this handler, WebKit cancels every download.
pub fn handle<R: Runtime>(_webview: Webview<R>, event: DownloadEvent<'_>) -> bool {
    match event {
        DownloadEvent::Requested { url, destination } => {
            if !may_download(&url) { return false; }
            DESTINATIONS.lock().unwrap_or_else(PoisonError::into_inner).insert(url.to_string(), destination.clone());
            true
        }
        DownloadEvent::Finished { url, path, success } => {
            let saved = DESTINATIONS.lock().unwrap_or_else(PoisonError::into_inner).remove(url.as_str());
            if success {
                if let Some(path) = path.or(saved) { let _ = tauri_plugin_opener::reveal_item_in_dir(path); }
            }
            true
        }
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_the_pages_own_files_download() {
        assert!(may_download(&Url::parse("blob:tauri://localhost/5f0c").unwrap()));
        assert!(!may_download(&Url::parse("https://example.com/report.pdf").unwrap()));
        assert!(!may_download(&Url::parse("data:application/pdf;base64,JVBERi0=").unwrap()));
        assert!(!may_download(&Url::parse("file:///etc/passwd").unwrap()));
    }
}
