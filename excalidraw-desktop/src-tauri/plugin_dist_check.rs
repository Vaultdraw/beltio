// Shared by `build.rs` (release gate) and a unit test (`src/plugin_dist_tests.rs`).
// A built official plugin must ship every file its manifest and its `main.js` point at.

/// Files a plugin's `dist/` must hold: `main` from `plugin.toml` plus every relative
/// `"./name.js"` string inside that main file (for example formula's `./worker-src.js`).
pub fn missing_plugin_dist_files(plugin_dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let dist = plugin_dir.join("dist");
    let manifest = std::fs::read_to_string(plugin_dir.join("plugin.toml")).unwrap_or_default();
    let main = manifest
        .lines()
        .filter_map(|l| l.trim().strip_prefix("main"))
        .filter_map(|r| r.trim_start().strip_prefix('='))
        .map(|v| v.trim().trim_matches('"').to_string())
        .next()
        .unwrap_or_else(|| "main.js".to_string());
    let mut need = vec![std::path::PathBuf::from(&main)];
    let code = std::fs::read_to_string(dist.join(&main)).unwrap_or_default();
    let mut rest = code.as_str();
    while let Some(i) = rest.find("\"./") {
        rest = &rest[i + 3..];
        let Some(end) = rest.find('"') else { break };
        let name = &rest[..end];
        if name.ends_with(".js") && !name.contains('/') && !name.contains(' ') {
            let p = std::path::PathBuf::from(name);
            if !need.contains(&p) {
                need.push(p);
            }
        }
    }
    need.into_iter().filter(|f| !dist.join(f).exists()).collect()
}
