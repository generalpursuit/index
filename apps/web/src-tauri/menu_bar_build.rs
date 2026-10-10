pub fn build() {
    println!("cargo:rerun-if-changed=native/menu_bar.m");
    println!("cargo:rerun-if-changed=icons/menu-bar.pdf");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") { return; }
    cc::Build::new().file("native/menu_bar.m").flag("-fobjc-arc").flag("-fblocks").compile("index_menu_bar");
    for framework in ["AppKit", "Foundation", "ServiceManagement"] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
}
