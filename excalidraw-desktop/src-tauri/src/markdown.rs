//! Markdown parsing for the app and its plugins: `markdown_parse` (text in, `NoteDoc` out) and
//! `markdown_parse_file` (a vault note). The parser is `vaultdraw_core::markdown`; nothing here
//! runs until a command is called.
use crate::{err, Result, Service};
use tauri::State;
use vaultdraw_core::markdown::{parse_markdown, parse_markdown_file, NoteDoc, ParseOptions, MAX_MARKDOWN_BYTES};

/// Refuses text over the note size limit (the same limit as notes read from disk).
pub(crate) fn check_size(text: &str) -> Result<()> {
    if text.len() as u64 > MAX_MARKDOWN_BYTES {
        return Err(err("INVALID_ARGUMENT", "Markdown text exceeds the 16 MiB limit"));
    }
    Ok(())
}

pub(crate) fn options(soft_break_newline: Option<bool>) -> ParseOptions {
    ParseOptions { soft_break_newline: soft_break_newline.unwrap_or(false) }
}

/// Parses Markdown text off the async runtime. Byte ranges in the result refer to `text`.
#[tauri::command]
pub(crate) async fn markdown_parse(text: String, soft_break_newline: Option<bool>) -> Result<NoteDoc> {
    check_size(&text)?;
    tauri::async_runtime::spawn_blocking(move || Ok(parse_markdown(&text, &options(soft_break_newline))))
        .await
        .map_err(|e| err("INTERNAL", &e.to_string()))?
}

/// Reads and parses the vault note `path` (`.md` or `.markdown`, vault-relative).
#[tauri::command]
pub(crate) async fn markdown_parse_file(
    handle: String,
    path: String,
    soft_break_newline: Option<bool>,
    state: State<'_, Service>,
) -> Result<NoteDoc> {
    let root = crate::vault_for(&state, &handle)?.root.clone();
    tauri::async_runtime::spawn_blocking(move || parse_markdown_file(&root, &path, &options(soft_break_newline)))
        .await
        .map_err(|e| err("INTERNAL", &e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn size_cap_and_options() {
        assert!(check_size("# hi").is_ok());
        let big = "a".repeat(MAX_MARKDOWN_BYTES as usize + 1);
        assert_eq!(check_size(&big).unwrap_err().code, "INVALID_ARGUMENT");
        assert!(!options(None).soft_break_newline);
        assert!(options(Some(true)).soft_break_newline);
    }
}
