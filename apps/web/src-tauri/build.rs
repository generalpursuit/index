mod sharing_build;

fn main() {
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
