pub fn build() {
    println!("cargo:rerun-if-changed=native/menu_bar.m");
    println!("cargo:rerun-if-changed=native/app_icon.m");
    println!("cargo:rerun-if-changed=native/dock.m");
    println!("cargo:rerun-if-changed=native/titlebar.m");
    println!("cargo:rerun-if-changed=native/haptics.m");
    println!("cargo:rerun-if-changed=icons/menu-bar.pdf");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") { return; }
    let mut native = cc::Build::new();
    native.file("native/menu_bar.m").file("native/app_icon.m").file("native/dock.m").file("native/titlebar.m").file("native/haptics.m").flag("-fobjc-arc").flag("-fblocks");
    if std::env::var_os("CARGO_FEATURE_NATIVE_SMOKE").is_some() {
        native.define("INDEX_NATIVE_SMOKE", None);
    }
    native.compile("index_menu_bar");
    for framework in ["AppKit", "Foundation", "QuartzCore", "ServiceManagement"] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
}
