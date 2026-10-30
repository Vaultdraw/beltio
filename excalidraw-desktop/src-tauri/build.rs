use std::path::Path;

include!("plugin_dist_check.rs");

/// `bundle.externalBin` makes tauri-build require `binaries/vaultdraw-<triple>`.
/// `tauri build` creates the real CLI first (beforeBuildCommand runs
/// scripts/build-cli.mjs); plain `cargo check/test` and `tauri dev` get a stub
/// that explains how to build it, so they keep working without that step.
fn ensure_cli_sidecar() {
    let triple = std::env::var("TARGET").expect("cargo sets TARGET");
    // tauri-build wants `.exe` on Windows targets.
    let ext = if triple.contains("windows") { ".exe" } else { "" };
    let path = format!("binaries/vaultdraw-{triple}{ext}");
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
    // Every folder under plugins/official with a plugin.toml (so a new official plugin needs no edit here).
    let root = Path::new("../../plugins/official");
    println!("cargo:rerun-if-changed={}", root.display());
    let mut ids: Vec<String> = std::fs::read_dir(root)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| e.path().join("plugin.toml").exists())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    ids.sort();
    for id in &ids {
        let dir = Path::new("../../plugins/official").join(id).join("dist");
        println!("cargo:rerun-if-changed={}", dir.display());
        if !dir.exists() {
            std::fs::create_dir_all(&dir).expect("create the official plugin dist folder");
        }
        // A release build must ship the plugin's real code (`npm run build` builds it first, via
        // its `prebuild` step, which `tauri build`'s beforeBuildCommand runs): an empty or stale
        // folder would silently drop the plugin, or its worker, from the app.
        if std::env::var("PROFILE").is_ok_and(|p| p == "release") {
            let missing = missing_plugin_dist_files(&Path::new("../../plugins/official").join(id));
            if !missing.is_empty() {
                panic!(
                    "official plugin {id} is not fully built (missing {missing:?}): run `node plugins/official/build.mjs` first"
                );
            }
        }
    }
}

fn main() {
    ensure_cli_sidecar();
    ensure_official_plugin_dirs();
    tauri_build::build()
}
