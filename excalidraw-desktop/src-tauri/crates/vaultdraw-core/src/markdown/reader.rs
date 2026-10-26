//! Reading a vault note for the parser: vault-relative path rules, a size cap and a lossy UTF-8
//! decode (a note with a few bad bytes still opens).

use super::{parse_markdown, NoteDoc, ParseOptions};
use crate::error::{err, ioerr, Result};
use crate::paths::safe_path;
use std::{fs::File, io::Read, path::Path};

/// Largest note the parser reads from disk.
pub const MAX_MARKDOWN_BYTES: u64 = 16 * 1024 * 1024;

fn is_markdown_name(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

/// Reads `path` (vault-relative, `/` separators, no `..`, no symbolic links) as text.
pub fn read_markdown_file(root: &Path, path: &str) -> Result<String> {
    if !is_markdown_name(path) {
        return Err(err("INVALID_PATH", "Only .md files can be parsed as notes"));
    }
    let p = safe_path(root, path, false)?;
    let file = File::open(&p).map_err(ioerr)?;
    let meta = file.metadata().map_err(ioerr)?;
    if !meta.is_file() {
        return Err(err("INVALID_FILE", "Not a regular file"));
    }
    if meta.len() > MAX_MARKDOWN_BYTES {
        return Err(err("INVALID_FILE", "Note exceeds the 16 MiB limit"));
    }
    let mut buf = Vec::with_capacity(meta.len() as usize);
    file.take(MAX_MARKDOWN_BYTES + 1).read_to_end(&mut buf).map_err(ioerr)?;
    if buf.len() as u64 > MAX_MARKDOWN_BYTES {
        return Err(err("INVALID_FILE", "Note exceeds the 16 MiB limit"));
    }
    Ok(match String::from_utf8(buf) {
        Ok(s) => s,
        Err(e) => String::from_utf8_lossy(e.as_bytes()).into_owned(),
    })
}

/// `read_markdown_file` then `parse_markdown`.
pub fn parse_markdown_file(root: &Path, path: &str, opts: &ParseOptions) -> Result<NoteDoc> {
    Ok(parse_markdown(&read_markdown_file(root, path)?, opts))
}
