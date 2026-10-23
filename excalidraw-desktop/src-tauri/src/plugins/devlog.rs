//! Dev plugin log: `<state dir>/plugin-logs/<id>.log`. Only plugins with `dev = true` write
//! here (the host sends their `ctx.log` lines and attributed errors). The file is capped at
//! 1 MB; past that, the last 256 KB are kept and the append goes on.
use super::manifest::is_valid_id;
use crate::{err, ioerr, write_atomic, Result};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

const DIR: &str = "plugin-logs";
pub(crate) const MAX_BYTES: u64 = 1024 * 1024;
pub(crate) const KEEP_BYTES: usize = 256 * 1024;
/// One call never writes more than this (a runaway loop cannot flood the disk in one go).
const MAX_APPEND: usize = 64 * 1024;

static WRITE: Mutex<()> = Mutex::new(());

pub(crate) fn log_path(state_dir: &Path, id: &str) -> PathBuf {
    state_dir.join(DIR).join(format!("{id}.log"))
}

/// Appends `text` (a newline is added when missing) to the log of plugin `id`.
pub(crate) fn append(state_dir: &Path, id: &str, text: &str) -> Result<()> {
    if !is_valid_id(id) {
        return Err(err("INVALID_ARGUMENT", "Invalid plugin id"));
    }
    let mut end = text.len().min(MAX_APPEND);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    let mut line = text[..end].to_string();
    if line.is_empty() {
        return Ok(());
    }
    if !line.ends_with('\n') {
        line.push('\n');
    }
    let _guard = WRITE.lock().map_err(|_| err("INTERNAL", "Dev log unavailable"))?;
    let path = log_path(state_dir, id);
    fs::create_dir_all(state_dir.join(DIR)).map_err(ioerr)?;
    let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    if size + line.len() as u64 > MAX_BYTES {
        let bytes = fs::read(&path).map_err(ioerr)?;
        let from = bytes.len().saturating_sub(KEEP_BYTES);
        let tail = &bytes[from..];
        // Start at a line boundary so the file never begins mid-line.
        let tail = match (from > 0).then(|| tail.iter().position(|b| *b == b'\n')).flatten() {
            Some(i) => &tail[i + 1..],
            None => tail,
        };
        write_atomic(&path, tail)?;
    }
    let mut f = fs::OpenOptions::new().create(true).append(true).open(&path).map_err(ioerr)?;
    f.write_all(line.as_bytes()).map_err(ioerr)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn appends_lines_and_adds_the_newline() {
        let tmp = tempdir().unwrap();
        append(tmp.path(), "demo", "[info] one").unwrap();
        append(tmp.path(), "demo", "[warn] two\n").unwrap();
        let text = fs::read_to_string(log_path(tmp.path(), "demo")).unwrap();
        assert_eq!(text, "[info] one\n[warn] two\n");
    }

    #[test]
    fn rejects_a_bad_id_and_never_leaves_the_log_folder() {
        let tmp = tempdir().unwrap();
        assert!(append(tmp.path(), "../evil", "x").is_err());
        assert!(append(tmp.path(), "A b", "x").is_err());
        assert!(!tmp.path().join(DIR).exists());
    }

    #[test]
    fn empty_text_creates_nothing() {
        let tmp = tempdir().unwrap();
        append(tmp.path(), "demo", "").unwrap();
        assert!(!log_path(tmp.path(), "demo").exists());
    }

    #[test]
    fn one_call_is_capped_on_a_char_boundary() {
        let tmp = tempdir().unwrap();
        let big = "é".repeat(MAX_APPEND); // 2 bytes each
        append(tmp.path(), "demo", &big).unwrap();
        let text = fs::read_to_string(log_path(tmp.path(), "demo")).unwrap();
        assert!(text.len() <= MAX_APPEND + 1);
    }

    #[test]
    fn stays_under_the_cap_and_keeps_the_newest_lines() {
        let tmp = tempdir().unwrap();
        let line = format!("{}\n", "x".repeat(1023));
        let n = (MAX_BYTES as usize / line.len()) + 400;
        for i in 0..n {
            append(tmp.path(), "demo", &format!("{i:04} {}", &line[5..])).unwrap();
        }
        let path = log_path(tmp.path(), "demo");
        let len = fs::metadata(&path).unwrap().len();
        assert!(len <= MAX_BYTES, "size {len}");
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.starts_with(|c: char| c.is_ascii_digit()), "starts at a line boundary");
        assert!(text.contains(&format!("{:04} ", n - 1)), "newest line kept");
        assert!(!text.contains("0000 "), "oldest line dropped");
    }
}
