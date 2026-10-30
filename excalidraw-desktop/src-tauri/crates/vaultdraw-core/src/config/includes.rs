//! `[include] files = [...]` in `config.toml` and in the files it includes: other TOML files
//! (or folders of them) that sit below the file naming them. Nothing here writes a file, and
//! nothing is read unless `config.toml` has an `[include]` table.
//!
//! Order, lowest first: for each entry (list order) the entry's own includes, then the entry;
//! the including file comes after all of them. Each file loads once; a cycle is skipped with a
//! warning. Missing, unreadable, symlinked, oversize or broken files are skipped with a row
//! that says why, and everything else applies.

use super::layers::{LayerInfo, KIND_INCLUDE};
use super::*;
use std::collections::{BTreeSet, HashSet};

/// Include nesting: files named by `config.toml` are depth 1.
pub const MAX_INCLUDE_DEPTH: usize = 8;
pub const MAX_INCLUDE_FILES: usize = 32;
pub const MAX_INCLUDE_BYTES: u64 = 4 * 1024 * 1024;

/// What the walk found. `layers` are the included files (lowest first), `warnings` are the
/// problems that name no file of their own (cycles, depth, caps).
#[derive(Debug, Default)]
pub struct IncludeScan {
    pub layers: Vec<LayerInfo>,
    pub warnings: Vec<String>,
    /// Folders to watch for changes: the folder of each named file, each named folder.
    pub watch_dirs: BTreeSet<PathBuf>,
    /// Named folders (any `*.toml` created inside counts).
    pub folders: BTreeSet<PathBuf>,
}

/// The paths a watcher has to care about (see `layer_files`).
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct LayerFiles {
    /// Every included file, loaded or not.
    pub files: Vec<PathBuf>,
    /// Non-recursive watch targets: the folders those files sit in, and named folders.
    pub dirs: Vec<PathBuf>,
    /// Named folders: any `*.toml` created inside counts.
    pub folders: Vec<PathBuf>,
}

pub fn home_dir() -> Option<PathBuf> {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var).filter(|h| !h.is_empty()).map(PathBuf::from)
}

/// The `include.files` entries of a parsed file: strings, plus a complaint when the shape is wrong.
fn entries_of(config: &Json) -> (Vec<String>, Option<&'static str>) {
    let Some(include) = config.get("include") else { return (Vec::new(), None) };
    let Some(files) = include.get("files") else {
        return (Vec::new(), if include.is_object() { None } else { Some("[include] must be a table") });
    };
    let Some(list) = files.as_array() else { return (Vec::new(), Some("include.files must be a list of paths")) };
    let strings: Vec<String> = list.iter().filter_map(|v| v.as_str().map(str::to_owned)).collect();
    let bad = (strings.len() != list.len()).then_some("include.files entries must be strings (others skipped)");
    (strings, bad)
}

/// A leading `~` is the home folder; relative paths are against the folder of the file that
/// lists them. `${VAR}` and `~user` are not supported.
fn expand(entry: &str, base: &Path, home: Option<&Path>) -> std::result::Result<PathBuf, String> {
    if entry.trim().is_empty() {
        return Err("empty include path".into());
    }
    if let Some(rest) = entry.strip_prefix('~') {
        let rest = match rest {
            "" => "",
            r if r.starts_with('/') || r.starts_with('\\') => r.trim_start_matches(['/', '\\']),
            _ => return Err(format!("{entry}: only a leading ~ or ~/ is supported")),
        };
        let home = home.ok_or_else(|| format!("{entry}: no home folder to expand ~"))?;
        return Ok(home.join(rest));
    }
    let p = Path::new(entry);
    Ok(if p.is_absolute() { p.to_path_buf() } else { base.join(p) })
}

/// True when `path` is inside a vault: any parent folder holds `.excalidraw-vault`, or the path
/// goes through one. A cloned vault must not pull in, or be pulled in as, config.
fn inside_vault(path: &Path) -> bool {
    let real = fs::canonicalize(path).or_else(|_| path.parent().map(fs::canonicalize).unwrap_or(Err(std::io::ErrorKind::NotFound.into()))).unwrap_or_else(|_| path.to_path_buf());
    real.ancestors().any(|a| a.file_name().is_some_and(|n| n == crate::paths::META_DIR) || a.join(crate::paths::META_DIR).is_dir())
}

struct Walk<'a> {
    home: Option<&'a Path>,
    scan: IncludeScan,
    seen: HashSet<PathBuf>,
    /// Canonical paths of the files being read, outermost first (cycle detection).
    stack: Vec<PathBuf>,
    total: u64,
    capped: bool,
}

fn display_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string_lossy().into_owned())
}

/// What a row is called: the file name, or the full path for an included file that shares a
/// name with `config.toml` or `overrides.toml` (a chip must never be mistaken for those).
fn row_name(path: &Path) -> String {
    let name = display_name(path);
    if name == CONFIG_FILE || name == super::layers::OVERRIDES_FILE {
        path.to_string_lossy().into_owned()
    } else {
        name
    }
}

impl Walk<'_> {
    fn row(&mut self, path: &Path, from: &Path, status: &'static str, message: String, line: Option<usize>, config: Option<Json>) {
        // Rows that load nothing count against the cap too, so a long list of missing paths
        // cannot grow the payload without bound. A file that did load always gets its row.
        if status != "ok" && self.scan.layers.len() >= MAX_INCLUDE_FILES {
            self.cap_warning();
            return;
        }
        self.scan.layers.push(LayerInfo {
            id: 0,
            kind: KIND_INCLUDE,
            name: row_name(path),
            path: path.to_string_lossy().into_owned(),
            status,
            error: (status != "ok").then_some(ConfigError { message, line }),
            config,
            from: Some(from.to_string_lossy().into_owned()),
        });
    }

    fn cap_warning(&mut self) {
        if !self.capped {
            self.capped = true;
            self.scan.warnings.push(format!("more than {MAX_INCLUDE_FILES} include files; the rest are skipped"));
        }
    }

    fn entries(&mut self, owner: &Path, config: &Json, depth: usize) {
        let (entries, bad) = entries_of(config);
        if let Some(bad) = bad {
            self.scan.warnings.push(format!("{}: {bad}", owner.display()));
        }
        let base = owner.parent().unwrap_or(Path::new("."));
        for entry in entries {
            match expand(&entry, base, self.home) {
                Ok(path) => self.entry(&path, owner, depth),
                Err(message) => self.scan.warnings.push(format!("{}: {message}", owner.display())),
            }
        }
    }

    fn entry(&mut self, path: &Path, from: &Path, depth: usize) {
        let meta = match fs::symlink_metadata(path) {
            Ok(m) => m,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                self.watch_parent(path);
                return self.row(path, from, "missing", format!("include not found: {}", path.display()), None, None);
            }
            Err(e) => return self.row(path, from, "error", format!("cannot read {}: {e}", path.display()), None, None),
        };
        if meta.file_type().is_symlink() {
            return self.row(path, from, "error", format!("{} is a symbolic link; only regular files and folders are read", path.display()), None, None);
        }
        if inside_vault(path) {
            return self.row(path, from, "error", format!("{} is inside a vault; includes never read vault files", path.display()), None, None);
        }
        if meta.is_dir() {
            self.scan.watch_dirs.insert(path.to_path_buf());
            self.scan.folders.insert(path.to_path_buf());
            let mut names: Vec<PathBuf> = match fs::read_dir(path) {
                Ok(rd) => rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "toml") && !p.is_dir()).collect(),
                Err(e) => return self.row(path, from, "error", format!("cannot read folder {}: {e}", path.display()), None, None),
            };
            names.sort();
            for file in names {
                self.file(&file, from, depth);
            }
        } else {
            self.watch_parent(path);
            self.file(path, from, depth);
        }
    }

    fn watch_parent(&mut self, path: &Path) {
        if let Some(parent) = path.parent() {
            self.scan.watch_dirs.insert(parent.to_path_buf());
        }
    }

    fn file(&mut self, path: &Path, from: &Path, depth: usize) {
        // A symlink is refused before anything is recorded, so it cannot hide its real target.
        if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
            return self.row(path, from, "error", format!("{} is a symbolic link; only regular files and folders are read", path.display()), None, None);
        }
        let canonical = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        if let Some(at) = self.stack.iter().position(|p| *p == canonical) {
            let chain: Vec<String> = self.stack[at..].iter().chain([&canonical]).map(|p| display_name(p)).collect();
            self.scan.warnings.push(format!("include cycle: {} (skipped)", chain.join(" -> ")));
            return;
        }
        if self.seen.contains(&canonical) {
            return; // already loaded: each file loads once
        }
        if depth > MAX_INCLUDE_DEPTH {
            self.scan.warnings.push(format!("{}: includes nest deeper than {MAX_INCLUDE_DEPTH} (skipped)", path.display()));
            return;
        }
        if self.scan.layers.len() >= MAX_INCLUDE_FILES {
            self.cap_warning();
            return;
        }
        self.seen.insert(canonical.clone());
        let name = path.to_string_lossy().into_owned();
        let text = match read_toml_text(path, &name, MAX_CONFIG_BYTES) {
            Ok(t) => t,
            Err(e) => return self.row(path, from, "error", e.message, None, None),
        };
        self.total += text.len() as u64;
        if self.total > MAX_INCLUDE_BYTES {
            return self.row(path, from, "error", format!("included files exceed {} in all; skipped", size_label(MAX_INCLUDE_BYTES)), None, None);
        }
        match parse_config(&text) {
            Ok(json) => {
                // This file's own includes sit below it.
                self.stack.push(canonical);
                self.entries(path, &json, depth + 1);
                self.stack.pop();
                self.row(path, from, "ok", String::new(), None, Some(json));
            }
            Err(e) => self.row(path, from, "error", e.message, e.line, None),
        }
    }
}

/// Reads the files `config` (the parsed `config.toml` at `config_path`) includes. Reads nothing
/// when `config` has no `[include]`.
pub(super) fn scan_includes(config_path: &Path, config: &Json, home: Option<&Path>) -> IncludeScan {
    let mut walk = Walk { home, scan: IncludeScan::default(), seen: HashSet::new(), stack: Vec::new(), total: 0, capped: false };
    if config.get("include").is_none() {
        return walk.scan;
    }
    let canonical = fs::canonicalize(config_path).unwrap_or_else(|_| config_path.to_path_buf());
    walk.seen.insert(canonical.clone());
    walk.stack.push(canonical);
    walk.entries(config_path, config, 1);
    for (i, l) in walk.scan.layers.iter_mut().enumerate() {
        l.id = 2 + i as u8; // 0 and 1 are config.toml and overrides.toml
    }
    walk.scan
}

/// The included files and the folders a watcher must watch to see them change. Pure: reads
/// `config.toml` and the include chain, never writes.
pub fn layer_files(dirs: &Dirs) -> LayerFiles {
    layer_files_with(dirs, home_dir().as_deref())
}

pub fn layer_files_with(dirs: &Dirs, home: Option<&Path>) -> LayerFiles {
    let path = dirs.config_file();
    // Cheap exit for the common case: no `[include]` text, nothing to parse.
    let Ok(text) = read_toml_text(&path, CONFIG_FILE, MAX_CONFIG_BYTES) else { return LayerFiles::default() };
    if !text.contains("include") {
        return LayerFiles::default();
    }
    let Ok(config) = parse_config(&text) else { return LayerFiles::default() };
    let scan = scan_includes(&path, &config, home);
    LayerFiles {
        files: scan.layers.iter().map(|l| PathBuf::from(&l.path)).collect(),
        dirs: scan.watch_dirs.iter().cloned().collect(),
        folders: scan.folders.iter().cloned().collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    struct Env {
        _t: tempfile::TempDir,
        root: PathBuf,
        dirs: Dirs,
    }
    fn env() -> Env {
        let t = tempdir().unwrap();
        let root = fs::canonicalize(t.path()).unwrap();
        let dirs = Dirs { config: root.join("config"), state: root.join("state") };
        fs::create_dir_all(&dirs.config).unwrap();
        Env { _t: t, root, dirs }
    }
    impl Env {
        fn write(&self, rel: &str, text: &str) -> PathBuf {
            let p = self.root.join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(&p, text).unwrap();
            p
        }
        fn load(&self) -> LoadedSettings {
            load_settings_in(&self.dirs).unwrap()
        }
        fn config(&self) -> Json {
            self.load().config.unwrap()
        }
    }
    const HOME_NONE: Option<&Path> = None;

    fn names(l: &LoadedSettings) -> Vec<String> {
        l.layers.iter().map(|l| l.name.clone()).collect()
    }

    #[test]
    fn no_include_table_reads_only_two_files() {
        let e = env();
        e.write("config/config.toml", "[editor]\nfont_size = 14\n");
        let l = e.load();
        assert_eq!(names(&l), vec!["config.toml", "overrides.toml"]);
        assert_eq!(layer_files_with(&e.dirs, HOME_NONE), LayerFiles::default());
    }

    #[test]
    fn relative_include_loads_below_config_toml_and_config_wins() {
        let e = env();
        e.write("config/config.toml", "[include]\nfiles = [\"keys.toml\"]\n[editor]\nfont_size = 14\n");
        e.write("config/keys.toml", "[editor]\nfont_size = 30\nroughness = 2\n");
        let l = e.load();
        assert_eq!(names(&l), vec!["keys.toml", "config.toml", "overrides.toml"]);
        let c = l.config.unwrap();
        assert_eq!(c["editor"]["font_size"], 14, "the including file wins");
        assert_eq!(c["editor"]["roughness"], 2);
        assert!(c.get("include").is_none(), "include is not part of the merged config");
        let inc = &l.layers[0];
        assert_eq!((inc.kind, inc.status, inc.id), ("include", "ok", 2));
        assert!(inc.from.as_deref().unwrap().ends_with("config.toml"));
    }

    #[test]
    fn later_entry_wins_over_earlier_and_nested_includes_sit_below_their_file() {
        let e = env();
        e.write("config/config.toml", "[include]\nfiles = [\"a.toml\", \"b.toml\"]\n");
        e.write("config/a.toml", "[include]\nfiles = [\"deep/c.toml\"]\n[editor]\nfont_size = 1\nroughness = 1\n");
        e.write("config/deep/c.toml", "[editor]\nfont_size = 9\nstroke_width = 9\n");
        e.write("config/b.toml", "[editor]\nroughness = 2\n");
        let l = e.load();
        assert_eq!(names(&l), vec!["c.toml", "a.toml", "b.toml", "config.toml", "overrides.toml"]);
        let c = l.config.unwrap();
        assert_eq!(c["editor"]["font_size"], 1, "a.toml beats the file it includes");
        assert_eq!(c["editor"]["roughness"], 2, "b.toml beats a.toml");
        assert_eq!(c["editor"]["stroke_width"], 9);
    }

    #[test]
    fn folder_loads_toml_files_sorted_and_not_recursive() {
        let e = env();
        e.write("config/config.toml", "[include]\nfiles = [\"machine/\"]\n");
        e.write("config/machine/20-b.toml", "[editor]\nfont_size = 2\n");
        e.write("config/machine/10-a.toml", "[editor]\nfont_size = 1\n");
        e.write("config/machine/notes.txt", "x");
        e.write("config/machine/sub/z.toml", "[editor]\nfont_size = 99\n");
        let l = e.load();
        assert_eq!(names(&l), vec!["10-a.toml", "20-b.toml", "config.toml", "overrides.toml"]);
        assert_eq!(l.config.unwrap()["editor"]["font_size"], 2);
    }

    #[test]
    fn tilde_expands_to_home() {
        let e = env();
        let home = e.root.join("home");
        e.write("home/dots/colors.toml", "[appearance]\nmode = \"dark\"\n");
        e.write("config/config.toml", "[include]\nfiles = [\"~/dots/colors.toml\"]\n");
        let layers = read_layers_with(&e.dirs, Some(&home));
        assert_eq!(merged(&layers.all).unwrap()["appearance"]["mode"], "dark");
        // Without a home folder the entry is a warning, not a failure.
        let none = read_layers_with(&e.dirs, None);
        assert_eq!(none.all.len(), 2);
        assert!(none.warnings[0].contains("no home folder"), "{:?}", none.warnings);
        let user = e.write("config/config.toml", "[include]\nfiles = [\"~bob/x.toml\"]\n");
        let _ = user;
        assert!(read_layers_with(&e.dirs, Some(&home)).warnings[0].contains("only a leading ~"));
    }

    #[test]
    fn a_missing_include_is_a_row_with_a_message_and_the_rest_applies() {
        let e = env();
        e.write("config/config.toml", "[include]\nfiles = [\"nope.toml\", \"here.toml\"]\n[editor]\nroughness = 0\n");
        e.write("config/here.toml", "[editor]\nfont_size = 7\n");
        let l = e.load();
        let miss = l.layers.iter().find(|l| l.name == "nope.toml").unwrap();
        assert_eq!(miss.status, "missing");
        assert!(miss.error.as_ref().unwrap().message.contains("include not found"));
        let c = l.config.unwrap();
        assert_eq!((c["editor"]["font_size"].clone(), c["editor"]["roughness"].clone()), (json!(7), json!(0)));
        assert!(l.layers.iter().all(|l| l.kind == "include" || l.status != "error"));
    }

    #[test]
    fn a_cycle_is_skipped_with_a_warning_naming_the_chain() {
        let e = env();
        e.write("config/config.toml", "[include]\nfiles = [\"a.toml\"]\n");
        e.write("config/a.toml", "[include]\nfiles = [\"b.toml\"]\n[editor]\nfont_size = 1\n");
        e.write("config/b.toml", "[include]\nfiles = [\"a.toml\"]\n[editor]\nroughness = 2\n");
        let layers = read_layers_with(&e.dirs, None);
        assert_eq!(layers.warnings, vec!["include cycle: a.toml -> b.toml -> a.toml (skipped)".to_string()]);
        let c = merged(&layers.all).unwrap();
        assert_eq!((c["editor"]["font_size"].clone(), c["editor"]["roughness"].clone()), (json!(1), json!(2)));
        // config.toml including itself is a cycle too.
        e.write("config/config.toml", "[include]\nfiles = [\"config.toml\"]\n");
        assert_eq!(read_layers_with(&e.dirs, None).warnings, vec!["include cycle: config.toml -> config.toml (skipped)".to_string()]);
    }

    #[test]
    fn a_file_listed_twice_loads_once_at_its_first_place() {
        let e = env();
        e.write("config/config.toml", "[include]\nfiles = [\"a.toml\", \"b.toml\", \"a.toml\"]\n");
        e.write("config/a.toml", "[editor]\nfont_size = 1\n");
        e.write("config/b.toml", "[editor]\nfont_size = 2\n");
        let l = e.load();
        assert_eq!(names(&l), vec!["a.toml", "b.toml", "config.toml", "overrides.toml"]);
        assert_eq!(l.config.unwrap()["editor"]["font_size"], 2);
    }

    #[test]
    fn depth_nine_is_refused_and_depth_eight_loads() {
        let e = env();
        e.write("config/config.toml", "[include]\nfiles = [\"f1.toml\"]\n");
        for i in 1..=9 {
            let next = if i < 10 { format!("[include]\nfiles = [\"f{}.toml\"]\n", i + 1) } else { String::new() };
            e.write(&format!("config/f{i}.toml"), &format!("{next}[editor]\nfont_size = {i}\n"));
        }
        let layers = read_layers_with(&e.dirs, None);
        let loaded: Vec<_> = layers.all.iter().filter(|l| l.kind == "include" && l.status == "ok").collect();
        assert_eq!(loaded.len(), 8, "f1 (depth 1) to f8 (depth 8)");
        assert!(layers.warnings.iter().any(|w| w.contains("nest deeper than 8")), "{:?}", layers.warnings);
    }

    #[test]
    fn caps_on_file_count_and_total_size() {
        let e = env();
        let list: Vec<String> = (0..40).map(|i| format!("\"f{i:02}.toml\"")).collect();
        e.write("config/config.toml", &format!("[include]\nfiles = [{}]\n", list.join(", ")));
        for i in 0..40 {
            e.write(&format!("config/f{i:02}.toml"), "[editor]\nfont_size = 1\n");
        }
        let layers = read_layers_with(&e.dirs, None);
        assert_eq!(layers.all.iter().filter(|l| l.kind == "include").count(), MAX_INCLUDE_FILES);
        assert!(layers.warnings.iter().any(|w| w.contains("more than 32")));
        // 5 files of about 900 KiB pass the 1 MiB file cap but not the 4 MiB total.
        let e = env();
        let big = format!("[notes]\ntext = \"{}\"\n", "x".repeat(900 * 1024));
        let list: Vec<String> = (0..5).map(|i| format!("\"b{i}.toml\"")).collect();
        e.write("config/config.toml", &format!("[include]\nfiles = [{}]\n", list.join(", ")));
        for i in 0..5 {
            e.write(&format!("config/b{i}.toml"), &big);
        }
        let layers = read_layers_with(&e.dirs, None);
        let bad: Vec<_> = layers.all.iter().filter(|l| l.kind == "include" && l.status == "error").collect();
        assert_eq!(bad.len(), 1);
        assert!(bad[0].error.as_ref().unwrap().message.contains("4 MiB"));
    }

    #[test]
    fn hundreds_of_missing_paths_stay_under_the_cap() {
        let e = env();
        let list: Vec<String> = (0..400).map(|i| format!("\"none{i}.toml\"")).collect();
        e.write("config/config.toml", &format!("[include]\nfiles = [{}]\n", list.join(", ")));
        let layers = read_layers_with(&e.dirs, None);
        let rows: Vec<_> = layers.all.iter().filter(|l| l.kind == "include").collect();
        assert_eq!(rows.len(), MAX_INCLUDE_FILES);
        assert!(layers.all.iter().map(|l| l.id).collect::<std::collections::HashSet<_>>().len() == layers.all.len(), "ids are unique");
        assert!(layers.warnings.iter().any(|w| w.contains("more than 32")));
    }

    #[test]
    fn an_included_file_named_config_toml_is_named_by_its_path() {
        let e = env();
        let nested = e.write("config/machine/config.toml", "[editor]\nfont_size = 3\n");
        e.write("config/config.toml", "[include]\nfiles = [\"machine/config.toml\"]\n");
        let l = e.load();
        assert_eq!(l.layers[0].name, nested.to_string_lossy());
        assert_eq!(l.layers[1].name, "config.toml");
    }

    #[cfg(unix)]
    #[test]
    fn a_refused_symlink_does_not_hide_its_target() {
        let e = env();
        e.write("dots/real.toml", "[editor]\nfont_size = 3\n");
        e.write("config/machine/keep.toml", "");
        std::os::unix::fs::symlink(e.root.join("dots/real.toml"), e.root.join("config/machine/a.toml")).unwrap();
        e.write("config/config.toml", &format!("[include]\nfiles = [\"machine/\", {:?}]\n", e.root.join("dots/real.toml").to_string_lossy()));
        let l = e.load();
        assert_eq!(l.config.unwrap()["editor"]["font_size"], 3, "the real file still loads");
        assert!(l.layers.iter().any(|l| l.name == "a.toml" && l.status == "error"));
    }

    #[test]
    fn bad_toml_oversize_and_bad_utf8_skip_only_that_file() {
        let e = env();
        e.write("config/config.toml", "[include]\nfiles = [\"bad.toml\", \"utf.toml\", \"huge.toml\", \"ok.toml\"]\n");
        e.write("config/bad.toml", "[editor\nx = 1\n");
        fs::write(e.root.join("config/utf.toml"), [0xff, 0xfe, 0x00]).unwrap();
        e.write("config/huge.toml", &"#".repeat(1024 * 1024 + 1));
        e.write("config/ok.toml", "[editor]\nfont_size = 5\n");
        let l = e.load();
        let by = |n: &str| l.layers.iter().find(|l| l.name == n).unwrap();
        assert_eq!(by("bad.toml").status, "error");
        assert_eq!(by("bad.toml").error.as_ref().unwrap().line, Some(1));
        assert!(by("utf.toml").error.as_ref().unwrap().message.contains("UTF-8"));
        assert!(by("huge.toml").error.as_ref().unwrap().message.contains("exceeds"));
        assert_eq!(l.config.unwrap()["editor"]["font_size"], 5);
        assert!(l.config_error.is_none(), "an include never becomes the config.toml error");
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_files_and_folders_are_refused() {
        let e = env();
        e.write("elsewhere/real.toml", "[editor]\nfont_size = 3\n");
        std::os::unix::fs::symlink(e.root.join("elsewhere/real.toml"), e.root.join("config/link.toml")).unwrap();
        std::os::unix::fs::symlink(e.root.join("elsewhere"), e.root.join("config/linkdir")).unwrap();
        e.write("config/config.toml", "[include]\nfiles = [\"link.toml\", \"linkdir\"]\n");
        let l = e.load();
        assert!(l.layers.iter().filter(|l| l.kind == "include").all(|l| l.status == "error" && l.error.as_ref().unwrap().message.contains("symbolic link")));
        assert_eq!(l.config.unwrap().get("editor"), None);
    }

    #[test]
    fn includes_inside_a_vault_are_refused() {
        let e = env();
        e.write("vault/.excalidraw-vault/settings.toml", "[editor]\nfont_size = 3\n");
        e.write("vault/notes/x.toml", "[editor]\nfont_size = 4\n");
        e.write("config/config.toml", &format!("[include]\nfiles = [{:?}, {:?}]\n", e.root.join("vault/notes/x.toml").to_string_lossy(), e.root.join("vault/.excalidraw-vault").to_string_lossy()));
        let l = e.load();
        let inc: Vec<_> = l.layers.iter().filter(|l| l.kind == "include").collect();
        assert_eq!(inc.len(), 2);
        assert!(inc.iter().all(|l| l.status == "error" && l.error.as_ref().unwrap().message.contains("inside a vault")));
        assert_eq!(l.config.unwrap().get("editor"), None);
    }

    #[test]
    fn include_in_overrides_is_ignored_with_a_warning_and_never_loads() {
        let e = env();
        e.write("config/config.toml", "[editor]\nfont_size = 1\n");
        e.write("config/x.toml", "[editor]\nfont_size = 9\n");
        e.write("state/overrides.toml", "[include]\nfiles = [\"../config/x.toml\"]\n");
        let l = e.load();
        assert_eq!(l.layers.iter().filter(|l| l.kind == "include").count(), 0);
        assert_eq!(l.config.unwrap()["editor"]["font_size"], 1);
        assert!(read_layers_with(&e.dirs, None).warnings[0].contains("overrides.toml: [include]"));
    }

    #[test]
    fn malformed_include_shapes_warn() {
        let e = env();
        e.write("config/config.toml", "[include]\nfiles = \"keys.toml\"\n");
        assert!(read_layers_with(&e.dirs, None).warnings[0].contains("must be a list"));
        e.write("config/config.toml", "[include]\nfiles = [1, \"a.toml\"]\n");
        e.write("config/a.toml", "[editor]\nfont_size = 5\n");
        let layers = read_layers_with(&e.dirs, None);
        assert!(layers.warnings[0].contains("must be strings"));
        assert_eq!(merged(&layers.all).unwrap()["editor"]["font_size"], 5);
    }

    #[test]
    fn config_toml_bytes_never_change_and_overrides_win_over_includes() {
        let e = env();
        let text = "[include]\nfiles = [\"a.toml\"]\n";
        let cfg = e.write("config/config.toml", text);
        let a = e.write("config/a.toml", "[editor]\nfont_size = 14\n");
        update_overrides_in(&e.dirs, &[LayerChange { key: "editor.font_size".into(), value: json!(22), default: None }]).unwrap();
        assert_eq!(fs::read_to_string(&cfg).unwrap(), text);
        assert_eq!(fs::read_to_string(&a).unwrap(), "[editor]\nfont_size = 14\n");
        assert_eq!(e.config()["editor"]["font_size"], 22);
        // A value an include already gives is redundant in overrides.
        update_overrides_in(&e.dirs, &[LayerChange { key: "editor.font_size".into(), value: json!(14), default: None }]).unwrap();
        assert_eq!(fs::read_to_string(e.dirs.overrides_file()).unwrap().contains("font_size"), false);
    }

    #[test]
    fn key_source_names_the_included_file() {
        let e = env();
        e.write("config/config.toml", "[include]\nfiles = [\"colors.toml\"]\n[editor]\nroughness = 2\n");
        let colors = e.write("config/colors.toml", "[editor]\nfont_size = 30\nroughness = 1\n");
        let layers = read_layers_with(&e.dirs, None).all;
        let s = key_source(&layers, "editor.font_size");
        assert_eq!(s.source, colors.to_string_lossy());
        assert_eq!(s.hidden, None);
        let r = key_source(&layers, "editor.roughness");
        assert_eq!(r.source, "config.toml");
        assert_eq!(r.hidden, Some(json!({"file": colors.to_string_lossy(), "value": 1})));
    }

    #[test]
    fn layer_files_lists_files_and_watch_dirs() {
        let e = env();
        e.write("config/config.toml", "[include]\nfiles = [\"machine/\", \"../outside/x.toml\", \"gone/y.toml\"]\n");
        e.write("config/machine/a.toml", "");
        e.write("outside/x.toml", "");
        let f = layer_files_with(&e.dirs, None);
        assert_eq!(f.files.len(), 3, "the missing file is listed too");
        assert!(f.dirs.contains(&e.dirs.config.join("machine")));
        assert!(f.dirs.contains(&e.dirs.config.join("../outside")));
        assert!(f.dirs.contains(&e.dirs.config.join("gone")), "a missing file's folder is watched when it exists to be");
        assert_eq!(f.folders, vec![e.dirs.config.join("machine")]);
    }

    #[test]
    fn control_enabled_through_an_include() {
        let e = env();
        e.write("config/config.toml", "[include]\nfiles = [\"c.toml\"]\n");
        e.write("config/c.toml", "[control]\nenabled = false\n");
        assert_eq!(layered_config_in(&e.dirs).unwrap()["control"]["enabled"], false);
    }

    // Hunter D round 2 (2026-10-30): cycles spelled in other ways, and shapes that look like a
    // cycle but are not one.
    #[test]
    fn a_diamond_is_not_a_cycle_and_loads_the_shared_file_once() {
        let e = env();
        e.write("config/config.toml", "[include]\nfiles = [\"b.toml\", \"c.toml\"]\n");
        e.write("config/b.toml", "[include]\nfiles = [\"d.toml\"]\n");
        e.write("config/c.toml", "[include]\nfiles = [\"d.toml\"]\n");
        e.write("config/d.toml", "[editor]\nfont_size = 4\n");
        let layers = read_layers_with(&e.dirs, None);
        assert!(layers.warnings.is_empty(), "{:?}", layers.warnings);
        assert_eq!(layers.all.iter().filter(|l| l.name == "d.toml").count(), 1);
    }

    #[test]
    fn a_cycle_through_other_spellings_of_the_same_path_is_still_a_cycle() {
        let e = env();
        e.write("config/config.toml", "[include]\nfiles = [\"a.toml\"]\n");
        e.write("config/a.toml", "[include]\nfiles = [\"./sub/../b.toml\"]\n[editor]\nfont_size = 1\n");
        e.write("config/b.toml", "[include]\nfiles = [\"../config/a.toml\"]\n");
        fs::create_dir_all(e.root.join("config/sub")).unwrap();
        let layers = read_layers_with(&e.dirs, None);
        assert_eq!(layers.warnings.len(), 1, "{:?}", layers.warnings);
        assert!(layers.warnings[0].contains("include cycle"), "{:?}", layers.warnings);
        assert_eq!(merged(&layers.all).unwrap()["editor"]["font_size"], 1);
    }

    #[test]
    fn a_cycle_through_a_folder_include_ends_and_keeps_the_values() {
        let e = env();
        e.write("config/config.toml", "[include]\nfiles = [\"d\"]\n");
        e.write("config/d/10.toml", "[include]\nfiles = [\"../d\"]\n[editor]\nfont_size = 6\n");
        e.write("config/d/20.toml", "[editor]\nroughness = 3\n");
        let l = e.load();
        let c = l.config.unwrap();
        assert_eq!((c["editor"]["font_size"].clone(), c["editor"]["roughness"].clone()), (json!(6), json!(3)));
    }

    #[test]
    fn a_long_cycle_and_a_wide_fan_of_cycles_stay_bounded() {
        let e = env();
        // a0 -> a1 -> ... -> a5 -> a0, and the config includes all of them.
        let all: Vec<String> = (0..6).map(|i| format!("\"a{i}.toml\"")).collect();
        e.write("config/config.toml", &format!("[include]\nfiles = [{}]\n", all.join(", ")));
        for i in 0..6 {
            e.write(&format!("config/a{i}.toml"), &format!("[include]\nfiles = [\"a{}.toml\"]\n", (i + 1) % 6));
        }
        let layers = read_layers_with(&e.dirs, None);
        assert!(layers.warnings.len() <= 6, "{:?}", layers.warnings);
        assert_eq!(layers.all.iter().filter(|l| l.kind == "include").count(), 6);
    }

    /// Timing with includes (run with `--release --ignored --nocapture`).
    #[test]
    #[ignore]
    fn bench_load_settings_with_includes() {
        let time = |label: &str, d: &Dirs| {
            load_settings_in(d).unwrap();
            let mut us: Vec<f64> = (0..3000)
                .map(|_| {
                    let s = std::time::Instant::now();
                    load_settings_in(d).unwrap();
                    s.elapsed().as_secs_f64() * 1e6
                })
                .collect();
            us.sort_by(|a, b| a.partial_cmp(b).unwrap());
            println!("{label}: p50 {:.0} us, p95 {:.0} us", us[us.len() / 2], us[us.len() * 95 / 100]);
        };
        for n in [0usize, 1, 3, 10] {
            let e = env();
            let list: Vec<String> = (0..n).map(|i| format!("\"i{i}.toml\"")).collect();
            let include = if n == 0 { String::new() } else { format!("[include]\nfiles = [{}]\n", list.join(", ")) };
            e.write("config/config.toml", &format!("{include}[editor]\nfont_size = 14\n"));
            for i in 0..n {
                e.write(&format!("config/i{i}.toml"), "[editor]\nroughness = 1\n[interface]\nzoom = 100\n[saving]\nautosave_delay_ms = 800\n");
            }
            time(&format!("load_settings_in, {n} include files"), &e.dirs);
        }
    }
}
