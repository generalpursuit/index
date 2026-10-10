use std::{env, path::PathBuf, process::Command};

pub fn build() {
    println!("cargo:rerun-if-changed=native/shared_session.m");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") { return; }
    let output = PathBuf::from(env::var("OUT_DIR").unwrap());
    let object = output.join("shared_session.o");
    let target = env::var("TARGET").unwrap();
    let arch = if target.starts_with("aarch64") { "arm64" } else { "x86_64" };
    let status = Command::new("xcrun").args(["clang", "-fobjc-arc", "-fmodules", "-arch", arch,
        "-mmacosx-version-min=14.0", "-c", "native/shared_session.m", "-o"])
        .arg(&object).status().expect("Xcode clang is required for shared Keychain storage");
    assert!(status.success(), "Shared Keychain bridge compilation failed");
    assert!(Command::new("xcrun").args(["ar", "crs"]).arg(output.join("libindex_shared_session.a"))
        .arg(object).status().unwrap().success());
    println!("cargo:rustc-link-search=native={}", output.display());
    println!("cargo:rustc-link-lib=static=index_shared_session");
    println!("cargo:rustc-link-lib=framework=Foundation");
    println!("cargo:rustc-link-lib=framework=Security");
}
