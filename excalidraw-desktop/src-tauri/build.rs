use std::path::Path;

/// `bundle.externalBin` makes tauri-build require `binaries/vaultdraw-<triple>`.
/// `tauri build` creates the real CLI first (beforeBuildCommand runs
/// scripts/build-cli.mjs); plain `cargo check/test` and `tauri dev` get a stub
/// that explains how to build it, so they keep working without that step.
fn ensure_cli_sidecar() {
    let triple = std::env::var("TARGET").expect("cargo sets TARGET");
    let path = format!("binaries/vaultdraw-{triple}");
    println!("cargo:rerun-if-changed={path}");
    if Path::new(&path).exists() {
        return;
    }
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        panic!("{path} is missing: run `node scripts/build-cli.mjs` first");
    }
    std::fs::create_dir_all("binaries").expect("create binaries/");
    std::fs::write(
        &path,
        "#!/bin/sh\necho 'vaultdraw: dev stub; run `node scripts/build-cli.mjs`' >&2\nexit 1\n",
    )
    .expect("write CLI stub");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .expect("chmod CLI stub");
    }
}

/// `bundle.resources` lists the built official plugins (`plugins/official/<id>/dist`, written
/// by `plugins/official/build.mjs`, which `npm run build` runs first). Plain `cargo check/test`
/// and `tauri dev` get an empty folder so they keep working without that step; the plugin is
/// then missing from that dev build until `node plugins/official/build.mjs` runs.
fn ensure_official_plugin_dirs() {
    // One entry per official plugin listed in tauri.conf.json `bundle.resources`.
    for id in ["markdown-import", "gallery", "graph"] {
        let dir = Path::new("../../plugins/official").join(id).join("dist");
        println!("cargo:rerun-if-changed={}", dir.display());
        if !dir.exists() {
            std::fs::create_dir_all(&dir).expect("create the official plugin dist folder");
        }
        // A release build must ship the plugin's real code (`npm run build` builds it first):
        // an empty folder would silently drop the plugin from the app.
        if std::env::var("PROFILE").is_ok_and(|p| p == "release") && !dir.join("main.js").exists() {
            panic!("official plugin {id} is not built: run `node plugins/official/build.mjs` first");
        }
    }
}

fn main() {
    ensure_cli_sidecar();
    ensure_official_plugin_dirs();
    tauri_build::build()
}
