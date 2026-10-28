// The release build's plugin dist check (`plugin_dist_check.rs`, also run by build.rs).

use std::path::{Path, PathBuf};
include!("../plugin_dist_check.rs");

fn temp_plugin(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("vd-dist-check-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("dist")).unwrap();
    std::fs::write(dir.join("plugin.toml"), "id = \"x\"\nmain = \"main.js\"\n").unwrap();
    dir
}

#[test]
fn a_missing_worker_src_is_reported() {
    let dir = temp_plugin("missing");
    std::fs::write(dir.join("dist/main.js"), "const w = \"./worker-src.js\";").unwrap();
    assert_eq!(missing_plugin_dist_files(&dir), vec![PathBuf::from("worker-src.js")]);
    std::fs::write(dir.join("dist/worker-src.js"), "export default \"\"").unwrap();
    assert!(missing_plugin_dist_files(&dir).is_empty());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_missing_main_is_reported() {
    let dir = temp_plugin("nomain");
    assert_eq!(missing_plugin_dist_files(&dir), vec![PathBuf::from("main.js")]);
    let _ = std::fs::remove_dir_all(&dir);
}

/// Every official plugin that has been built in this checkout is complete (formula needs
/// `worker-src.js`). A folder with no `main.js` is an unbuilt dev stub and is skipped.
#[test]
fn built_official_plugins_have_all_their_files() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins/official");
    for entry in std::fs::read_dir(&root).unwrap().flatten() {
        let dir = entry.path();
        if dir.join("plugin.toml").exists() && dir.join("dist/main.js").exists() {
            let missing = missing_plugin_dist_files(&dir);
            assert!(missing.is_empty(), "{:?} is missing {missing:?}: run node plugins/official/build.mjs", dir.file_name());
        }
    }
}
