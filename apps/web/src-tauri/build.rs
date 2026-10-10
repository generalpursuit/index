mod notification_build;
fn main() {
    notification_build::build();
    println!("cargo:rerun-if-env-changed=VITE_SERVER_URL");
    let server =
        std::env::var("VITE_SERVER_URL").unwrap_or_else(|_| "http://localhost:8080".into());
    println!(
        "cargo:rustc-env=INDEX_API_SERVER={}",
        server.trim_end_matches('/')
    );
    tauri_build::build()
}
