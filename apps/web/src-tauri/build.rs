mod sharing_build;

mod notification_build;
mod menu_bar_build;
fn main() {
    for (key, fallback) in [("INDEX_DESKTOP_CHANNEL", "development"), ("INDEX_DESKTOP_IDENTIFIER", "com.generalpursuit.index")] {
        println!("cargo:rerun-if-env-changed={key}");
        println!("cargo:rustc-env={key}={}", std::env::var(key).unwrap_or_else(|_| fallback.into()));
    }
    notification_build::build();
    menu_bar_build::build();
    println!("cargo:rerun-if-env-changed=VITE_SERVER_URL");
    let server =
        std::env::var("VITE_SERVER_URL").unwrap_or_else(|_| "http://localhost:8080".into());
    println!(
        "cargo:rustc-env=INDEX_API_SERVER={}",
        server.trim_end_matches('/')
    );
    sharing_build::build();
    tauri_build::build()
}
