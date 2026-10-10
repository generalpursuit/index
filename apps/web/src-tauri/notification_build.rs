pub fn build() {
    println!("cargo:rerun-if-changed=native/notifications.m");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") { return; }
    cc::Build::new().file("native/notifications.m").flag("-fobjc-arc").flag("-fblocks").compile("index_notifications");
    for framework in ["AppKit", "Foundation", "UserNotifications", "Security"] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
}
