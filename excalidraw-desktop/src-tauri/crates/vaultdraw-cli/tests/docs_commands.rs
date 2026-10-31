//! Family hunter shell, 2026-10-31: "every `vaultdraw ...` command the README and the docs show
//! parses". A command that the docs promise and the parser refuses (renamed subcommand, dropped
//! flag) is a user's first failure. Each code-block line that starts with `vaultdraw` is run with
//! `--print-request`, which parses and prints the request without needing the app. Lines that are
//! not commands (a folder tree, a shell redirect, a usage line with `[...]` or `<...>`) are skipped.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../..").canonicalize().unwrap()
}

/// Splits like a shell for the simple cases the docs use: spaces, single and double quotes.
fn split(line: &str) -> Option<Vec<String>> {
    let (mut out, mut cur, mut quote, mut any) = (Vec::new(), String::new(), None::<char>, false);
    for c in line.chars() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), c) => cur.push(c),
            (None, '\'' | '"') => {
                quote = Some(c);
                any = true;
            }
            (None, c) if c.is_whitespace() => {
                if any || !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                    any = false;
                }
            }
            (None, c) => cur.push(c),
        }
    }
    if quote.is_some() {
        return None;
    }
    if any || !cur.is_empty() {
        out.push(cur);
    }
    Some(out)
}

fn documented_commands() -> Vec<(String, usize, Vec<String>)> {
    let root = repo_root();
    let mut files = vec![root.join("README.md")];
    for e in std::fs::read_dir(root.join("docs")).unwrap().flatten() {
        if e.path().extension().is_some_and(|x| x == "md") {
            files.push(e.path());
        }
    }
    files.sort();
    let mut found = Vec::new();
    for f in files {
        let text = std::fs::read_to_string(&f).unwrap();
        let mut in_block = false;
        for (i, line) in text.lines().enumerate() {
            if line.trim_start().starts_with("```") {
                in_block = !in_block;
                continue;
            }
            let t = line.trim_start().trim_start_matches("$ ");
            let Some(rest) = t.strip_prefix("vaultdraw") else { continue };
            if !in_block || !(rest.is_empty() || rest.starts_with(' ')) {
                continue;
            }
            // Drop a trailing comment.
            let rest = rest.split(" #").next().unwrap_or(rest).trim();
            let not_a_command = rest.is_empty()
                || rest.contains(['>', '<', '[', '|', '\\', '$'])
                || rest.contains("...")
                || rest.starts_with('/');
            if not_a_command {
                continue;
            }
            if let Some(args) = split(rest) {
                found.push((f.file_name().unwrap().to_string_lossy().into_owned(), i + 1, args));
            }
        }
    }
    found
}

#[test]
fn every_documented_command_parses() {
    let cmds = documented_commands();
    assert!(cmds.len() >= 20, "found only {} documented commands: the scan is broken", cmds.len());
    let mut bad = Vec::new();
    for (file, line, args) in &cmds {
        let out = Command::new(env!("CARGO_BIN_EXE_vaultdraw-cli"))
            .arg("--print-request")
            .args(args)
            .stdin(Stdio::null())
            .output()
            .unwrap();
        let err = String::from_utf8_lossy(&out.stderr);
        if out.status.code() == Some(2) || err.contains("unrecognized") || err.contains("unexpected argument") || err.contains("required arguments") {
            bad.push(format!("{file}:{line}: vaultdraw {} -> {}", args.join(" "), err.lines().next().unwrap_or("")));
        }
    }
    assert!(bad.is_empty(), "documented commands the parser refuses:\n{}", bad.join("\n"));
}
