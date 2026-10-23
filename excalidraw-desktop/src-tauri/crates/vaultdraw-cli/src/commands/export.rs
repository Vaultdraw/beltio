//! `vaultdraw export`: the app renders a drawing (PNG, SVG or PDF) and the bytes come back
//! base64 encoded; this writes them to a file or stdout. Needs the running app (no offline path).

use super::target;
use crate::cli::{Cli, ExportArgs};
use crate::error::{Fail, EXIT_PROTOCOL, EXIT_REFUSED};
use crate::rpc::{request_line, resolve_socket, Rpc};
use serde_json::{json, Value};
use std::io::{IsTerminal, Write};
use std::path::{Path, PathBuf};
use vaultdraw_protocol::methods;

/// The app waits up to 120 s for a render (`EXPORT_TIMEOUT`); the CLI must wait at least as long.
const REPLY_WAIT_SECS: u64 = 125;

pub fn run(cli: &Cli, args: &ExportArgs) -> Result<(), Fail> {
    let to_stdout = args.out.as_deref() == Some("-");
    // `-o <existing folder>` writes the drawing's file name into that folder.
    let out_dir = args.out.as_deref().filter(|o| *o != "-" && Path::new(o).is_dir());
    let file_out = args.out.as_deref().filter(|o| *o != "-" && out_dir.is_none());
    let format = export_format(args.format.as_deref(), file_out)?;
    check_pdf_options(args, &format)?;
    let params = Value::Object(with_target(cli, &args.target, render_params(args, &format)));
    if cli.print_request {
        let line = match &args.out_dir {
            // A folder batch starts with this listing (the drawings come from its reply).
            Some(_) => request_line(methods::VAULT_LIST, Some(list_params(&args.target))),
            None => request_line(methods::EXPORT_RENDER, Some(params)),
        };
        println!("{line}");
        return Ok(());
    }
    if let Some(dir) = args.out_dir.as_deref() {
        return export_folder(cli, args, &format, resolve_socket(cli.socket.as_deref())?, Path::new(dir));
    }
    if to_stdout && cli.json {
        return Err(Fail::cli("--json cannot be combined with -o - (stdout carries the file's bytes)"));
    }
    if to_stdout && !args.force && std::io::stdout().is_terminal() {
        return Err(Fail::cli("refusing to write binary output to a terminal (redirect it, use -o <file>, or pass --force)"));
    }
    // Fail before the render when the destination is known and taken. Without -o (or with a
    // folder) the name is the one the app will give it; the write checks the real name again.
    let planned = file_name_for(&args.target, &format, args.embed_scene);
    match (file_out, out_dir) {
        (Some(file), _) => check_free(Path::new(file), args.force)?,
        (None, Some(dir)) => check_free(&Path::new(dir).join(&planned), args.force)?,
        (None, None) if !to_stdout => check_free(Path::new(&planned), args.force)?,
        _ => {}
    }
    let socket = resolve_socket(cli.socket.as_deref())?;
    let reply = Rpc::new(socket, cli.timeout.max(REPLY_WAIT_SECS)).call(methods::EXPORT_RENDER, Some(params))?;
    let bytes = decode_reply(&reply)?;
    let size = reply.get("size").and_then(Value::as_u64).unwrap_or(0);
    let path = reply.get("path").and_then(Value::as_str).unwrap_or("").to_string();
    let file_name = reply.get("fileName").and_then(Value::as_str).unwrap_or("").to_string();
    let mime = reply.get("mime").and_then(Value::as_str).unwrap_or("").to_string();

    let out = if to_stdout {
        let mut o = std::io::stdout().lock();
        o.write_all(&bytes).and_then(|()| o.flush()).map_err(|e| Fail::cli(format!("cannot write to stdout: {e}")))?;
        "-".to_string()
    } else {
        let dest = match (file_out, out_dir) {
            (Some(file), _) => PathBuf::from(file),
            (None, Some(dir)) => Path::new(dir).join(safe_name(&file_name)?),
            (None, None) => PathBuf::from(safe_name(&file_name)?),
        };
        write_file(&dest, &bytes, args.force)?;
        dest.display().to_string()
    };
    let value = json!({"path": path, "fileName": file_name, "mime": mime, "size": size, "out": out});
    let human = format!("exported {path} -> {out} ({size} bytes)");
    if cli.json {
        println!("{}", serde_json::to_string(&value).unwrap_or_default());
    } else if to_stdout {
        eprintln!("{human}");
    } else {
        println!("{human}");
    }
    Ok(())
}

/// The export options as `export.render` params (format, scale, flags); no target.
fn render_params(args: &ExportArgs, format: &str) -> serde_json::Map<String, Value> {
    let mut p = serde_json::Map::new();
    p.insert("format".into(), json!(format));
    if let Some(s) = args.scale {
        p.insert("scale".into(), json!(s));
    }
    for (set, key) in [(args.dark, "dark"), (args.embed_scene, "embedScene"), (args.page, "pageShaped")] {
        if set {
            p.insert(key.into(), json!(true));
        }
    }
    for (set, key) in [(args.no_background, "background"), (args.no_pattern, "pattern")] {
        if set {
            p.insert(key.into(), json!(false));
        }
    }
    if let Some(frame) = &args.frame {
        p.insert("frame".into(), json!(frame));
    }
    if let Some(px) = args.padding {
        p.insert("padding".into(), json!(px));
    }
    p
}

/// `params` with the target added (`path` or `file`, see `target`).
fn with_target(cli: &Cli, target_arg: &str, mut params: serde_json::Map<String, Value>) -> serde_json::Map<String, Value> {
    let mut p = target(cli, target_arg);
    p.append(&mut params);
    p
}

/// `vault.list` params for a folder target: recursive; `.`, `/` or `` is the vault root.
fn list_params(target_arg: &str) -> Value {
    let dir = target_arg.trim_end_matches('/');
    let dir = if dir == "." { "" } else { dir };
    json!({"dir": dir, "recursive": true})
}

/// The drawing paths of a `vault.list` reply, in its order.
fn listed_drawings(reply: &Value) -> Result<Vec<String>, Fail> {
    let entries = reply.get("entries").and_then(Value::as_array).ok_or_else(|| bad_reply("vault.list reply has no entries"))?;
    Ok(entries
        .iter()
        .filter(|e| e.get("kind").and_then(Value::as_str) == Some("drawing"))
        .filter_map(|e| e.get("path").and_then(Value::as_str).map(str::to_string))
        .collect())
}

/// Exports each drawing of a folder (recursively) into `out_dir` on one connection, one after
/// another. An app refusal or a local write failure is reported and the batch goes on; a lost
/// connection or a bad reply stops it. Any failed drawing makes the exit code 2.
fn export_folder(cli: &Cli, args: &ExportArgs, format: &str, socket: PathBuf, out_dir: &Path) -> Result<(), Fail> {
    let rpc = Rpc::new(socket, cli.timeout.max(REPLY_WAIT_SECS));
    let mut client = rpc.connect()?;
    let paths = match rpc.call_on(&mut client, methods::VAULT_LIST, Some(list_params(&args.target))) {
        Ok(reply) => listed_drawings(&reply)?,
        Err(f) if f.tag == "NOT_FOUND" || f.tag == "INVALID_PATH" => {
            return Err(Fail::new(f.exit, format!("{} is not a folder of the vault (--out-dir exports a folder; a drawing takes -o <file>)", args.target), &f.tag));
        }
        Err(f) => return Err(f),
    };
    let options = render_params(args, format);
    let (mut done, total) = (0usize, paths.len());
    for path in &paths {
        let result = match out_path(out_dir, path, format) {
            Some(out) => export_one(&rpc, &mut client, &options, path, &out, args.force).map(|size| (out, size)),
            None => Err(bad_reply(format!("vault.list returned an unsafe path {path:?}"))),
        };
        let out_text = |out: &Path| out.display().to_string();
        match result {
            Ok((out, size)) => {
                done += 1;
                if cli.json {
                    println!("{}", json!({"path": path, "out": out_text(&out), "size": size, "ok": true}));
                } else {
                    println!("exported {path} -> {} ({size} bytes)", out_text(&out));
                }
            }
            Err(f) if f.exit == EXIT_REFUSED || f.tag == "CLI_ERROR" => {
                eprintln!("vaultdraw: {path}: {} ({})", f.message, f.tag);
                if cli.json {
                    println!("{}", json!({"path": path, "ok": false, "code": f.tag, "error": f.message}));
                }
            }
            Err(f) => {
                // The connection or the protocol failed: the rest would fail the same way.
                eprintln!("vaultdraw: stopped after {done} of {total} drawings");
                return Err(f);
            }
        }
    }
    let summary = format!("exported {done} of {total} drawings to {}", out_dir.display());
    if cli.json {
        eprintln!("{summary}");
    } else {
        println!("{summary}");
    }
    if done < total {
        return Err(Fail::new(EXIT_REFUSED, format!("{} of {total} drawings failed", total - done), "EXPORT_FAILED"));
    }
    Ok(())
}

/// One drawing of a batch: render on the open connection, then write (never over an existing file
/// without `--force`, creating the folders it needs). Returns the bytes written.
fn export_one(rpc: &Rpc, client: &mut vaultdraw_protocol::client::Client, options: &serde_json::Map<String, Value>, path: &str, out: &Path, force: bool) -> Result<u64, Fail> {
    check_free(out, force)?;
    let mut p = options.clone();
    p.insert("path".into(), json!(path));
    let reply = rpc.call_on(client, methods::EXPORT_RENDER, Some(Value::Object(p)))?;
    let bytes = decode_reply(&reply)?;
    if let Some(parent) = out.parent().filter(|d| !d.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(|e| Fail::cli(format!("cannot create {}: {e}", parent.display())))?;
    }
    write_file(out, &bytes, force)?;
    Ok(bytes.len() as u64)
}

/// `<dir>/<drawing path>` with the `.excalidraw` suffix replaced by the export's extension. None
/// unless `path` is a safe vault-relative drawing path (the reply decides where files are written,
/// so it must never reach outside `dir`: no `..`, no absolute path, no backslash).
fn out_path(dir: &Path, path: &str, format: &str) -> Option<PathBuf> {
    if path.is_empty() || vaultdraw_core::validate_relative(path).is_err() {
        return None;
    }
    let cut = path.len().checked_sub(".excalidraw".len())?;
    if !path.is_char_boundary(cut) || !path[cut..].eq_ignore_ascii_case(".excalidraw") || cut == 0 || path[..cut].ends_with('/') {
        return None;
    }
    Some(dir.join(format!("{}.{format}", &path[..cut])))
}

fn bad_reply(message: impl Into<String>) -> Fail {
    Fail::new(EXIT_PROTOCOL, message, "BAD_REPLY")
}

/// The format: `--format`, else the `-o` file's extension, else png. A `-o` file must end in
/// .png, .svg or .pdf, and it must agree with `--format` when both are given.
fn export_format(flag: Option<&str>, file_out: Option<&str>) -> Result<String, Fail> {
    let Some(file) = file_out else {
        return Ok(flag.unwrap_or("png").to_string());
    };
    let Some(ext) = format_of_ext(file) else {
        return Err(Fail::cli(format!("{file}: -o needs a .png, .svg or .pdf file name, or an existing folder")));
    };
    match flag {
        Some(f) if f != ext => Err(Fail::cli(format!("--format {f} does not match the .{ext} extension of {file}"))),
        _ => Ok(ext),
    }
}

/// PDF has fixed pages: it always paints the background in the light theme at its own
/// resolution, so these options would be ignored. Refused before any request.
fn check_pdf_options(args: &ExportArgs, format: &str) -> Result<(), Fail> {
    if format != "pdf" {
        return Ok(());
    }
    let set: Vec<&str> = [
        (args.dark, "--dark"),
        (args.no_background, "--no-background"),
        (args.scale.is_some(), "--scale"),
        (args.embed_scene, "--embed-scene"),
        (args.page, "--page"),
        (args.frame.is_some(), "--frame"),
        (args.padding.is_some(), "--padding"),
    ]
    .into_iter()
    .filter_map(|(on, flag)| on.then_some(flag))
    .collect();
    if set.is_empty() {
        return Ok(());
    }
    Err(Fail::cli(format!("{} {} not apply to pdf", set.join(", "), if set.len() == 1 { "does" } else { "do" })))
}

/// The file name the app gives an export of `target` (as `exportFileName` in the app): the
/// drawing's name without `.excalidraw`, `.excalidraw` again when the scene is embedded, then
/// the format.
fn file_name_for(target: &str, format: &str, embed_scene: bool) -> String {
    let name = target.rsplit('/').next().unwrap_or(target);
    let base = if name.to_ascii_lowercase().ends_with(".excalidraw") { &name[..name.len() - ".excalidraw".len()] } else { name };
    let base = if base.is_empty() { "Drawing" } else { base };
    let embed = if embed_scene && format != "pdf" { ".excalidraw" } else { "" };
    format!("{base}{embed}.{format}")
}

/// `png`, `svg` or `pdf` from a file extension (case-insensitive).
fn format_of_ext(out: &str) -> Option<String> {
    let ext = Path::new(out).extension()?.to_str()?.to_ascii_lowercase();
    matches!(ext.as_str(), "png" | "svg" | "pdf").then_some(ext)
}

/// The decoded bytes; refuses a reply without `bytes`, with bad base64 or a wrong `size`.
fn decode_reply(reply: &Value) -> Result<Vec<u8>, Fail> {
    let bad = |what: &str| Fail::new(EXIT_PROTOCOL, format!("the app's reply has {what}"), "BAD_REPLY");
    let text = reply.get("bytes").and_then(Value::as_str).ok_or_else(|| bad("no bytes"))?;
    let bytes = base64_decode(text).ok_or_else(|| bad("bytes that are not base64"))?;
    if reply.get("size").and_then(Value::as_u64) != Some(bytes.len() as u64) {
        return Err(bad("a size that does not match its bytes"));
    }
    Ok(bytes)
}

/// The app's file name, reduced to its last component (it names a file here, never a path).
fn safe_name(name: &str) -> Result<String, Fail> {
    Path::new(name)
        .file_name()
        .and_then(|n| n.to_str())
        .map(str::to_string)
        .ok_or_else(|| Fail::new(EXIT_PROTOCOL, "the app's reply has no file name", "BAD_REPLY"))
}

fn taken(dest: &Path) -> Fail {
    Fail::cli(format!("{} already exists (use --force to overwrite it)", dest.display()))
}

fn check_free(dest: &Path, force: bool) -> Result<(), Fail> {
    if !force && dest.exists() {
        return Err(taken(dest));
    }
    Ok(())
}

/// Writes `<dest>.tmp-<pid>`, then moves it into place, so a failed write leaves no partial file.
/// Without `force` the move itself refuses an existing file (a hard link fails when the name is
/// taken), so a file created by someone else during the render is never replaced.
fn write_file(dest: &Path, bytes: &[u8], force: bool) -> Result<(), Fail> {
    check_free(dest, force)?;
    let tmp = PathBuf::from(format!("{}.tmp-{}", dest.display(), std::process::id()));
    let fail = |e: std::io::Error| Fail::cli(format!("cannot write {}: {e}", dest.display()));
    if let Err(e) = std::fs::write(&tmp, bytes) {
        let _ = std::fs::remove_file(&tmp);
        return Err(fail(e));
    }
    let placed = if force { std::fs::rename(&tmp, dest) } else { place_new(&tmp, dest, bytes) };
    let _ = std::fs::remove_file(&tmp);
    match placed {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Err(taken(dest)),
        Err(e) => Err(fail(e)),
    }
}

/// Moves `tmp` to a `dest` that must not exist yet. A hard link is atomic and fails on an
/// existing name; on a filesystem without hard links, an exclusive create (`O_EXCL`) does the
/// same check (the file is then filled in place).
fn place_new(tmp: &Path, dest: &Path, bytes: &[u8]) -> std::io::Result<()> {
    match std::fs::hard_link(tmp, dest) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Err(e),
        Err(_) => {
            let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(dest)?;
            f.write_all(bytes).inspect_err(|_| {
                let _ = std::fs::remove_file(dest);
            })
        }
    }
}

/// Standard base64 (RFC 4648, `+` and `/`, `=` padding). Rejects anything else, including
/// stray padding and non-zero bits below the last digit.
pub(crate) fn base64_decode(s: &str) -> Option<Vec<u8>> {
    fn digit(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a' + 26) as u32),
            b'0'..=b'9' => Some((c - b'0' + 52) as u32),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let b = s.as_bytes();
    if b.len() % 4 != 0 {
        return None;
    }
    let last = (b.len() / 4).saturating_sub(1);
    let mut out = Vec::with_capacity(b.len() / 4 * 3);
    for (i, q) in b.chunks(4).enumerate() {
        let pad = match (q[2], q[3]) {
            (b'=', b'=') => 2,
            (_, b'=') => 1,
            (b'=', _) => return None,
            _ => 0,
        };
        if pad > 0 && i != last {
            return None;
        }
        let mut n = 0u32;
        for (j, c) in q.iter().enumerate() {
            let v = if j < 4 - pad { digit(*c)? } else { 0 };
            n = (n << 6) | v;
        }
        // Unused low bits of the last digit must be zero (canonical encoding).
        if (pad == 2 && n & 0x0000_f000 != 0) || (pad == 1 && n & 0x0000_00c0 != 0) {
            return None;
        }
        out.push((n >> 16) as u8);
        if pad < 2 {
            out.push((n >> 8) as u8);
        }
        if pad == 0 {
            out.push(n as u8);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_comes_from_the_flag_or_the_extension_and_they_must_agree() {
        assert_eq!(export_format(None, None).unwrap(), "png");
        assert_eq!(export_format(Some("svg"), None).unwrap(), "svg");
        assert_eq!(export_format(None, Some("a/B.PDF")).unwrap(), "pdf");
        assert_eq!(export_format(Some("png"), Some("x.png")).unwrap(), "png");
        assert!(export_format(Some("svg"), Some("x.png")).unwrap_err().message.contains("does not match"));
        for bad in ["x.jpg", "x", "x.excalidraw"] {
            assert!(export_format(None, Some(bad)).unwrap_err().message.contains(".png, .svg or .pdf"), "{bad}");
        }
    }

    #[test]
    fn file_name_for_matches_the_apps_export_file_name() {
        assert_eq!(file_name_for("Plans/Roadmap.excalidraw", "png", false), "Roadmap.png");
        assert_eq!(file_name_for("Roadmap", "svg", true), "Roadmap.excalidraw.svg");
        assert_eq!(file_name_for("Roadmap.EXCALIDRAW", "pdf", true), "Roadmap.pdf");
        assert_eq!(file_name_for(".excalidraw", "png", false), "Drawing.png");
    }

    #[test]
    fn writing_never_replaces_a_file_that_appeared_after_the_check() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("out.png");
        let tmp = dir.path().join("out.png.tmp");
        std::fs::write(&tmp, b"new").unwrap();
        // Someone else creates the file between the check and the move.
        std::fs::write(&dest, b"theirs").unwrap();
        let e = place_new(&tmp, &dest, b"new").unwrap_err();
        assert_eq!(e.kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(std::fs::read(&dest).unwrap(), b"theirs");
        std::fs::remove_file(&dest).unwrap();
        place_new(&tmp, &dest, b"new").unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"new");
    }

    #[test]
    fn out_path_keeps_subfolders_and_swaps_the_extension() {
        let d = Path::new("/out");
        assert_eq!(out_path(d, "a.excalidraw", "png").unwrap(), Path::new("/out/a.png"));
        assert_eq!(out_path(d, "Graphs/sub/b.Excalidraw", "svg").unwrap(), Path::new("/out/Graphs/sub/b.svg"));
        assert_eq!(out_path(d, "Ünïcode/é.excalidraw", "pdf").unwrap(), Path::new("/out/Ünïcode/é.pdf"));
    }

    #[test]
    fn out_path_refuses_paths_that_leave_the_out_dir_or_are_not_drawings() {
        let d = Path::new("/out");
        for bad in ["", "../x.excalidraw", "a/../../x.excalidraw", "/etc/x.excalidraw", "a\\..\\x.excalidraw", "./x.excalidraw", "a//b.excalidraw", ".excalidraw", "a/.excalidraw", "notes.md", "é"] {
            assert!(out_path(d, bad, "png").is_none(), "{bad}");
        }
    }

    #[test]
    fn list_params_maps_the_root_and_trailing_slashes() {
        assert_eq!(list_params("."), json!({"dir":"","recursive":true}));
        assert_eq!(list_params("/"), json!({"dir":"","recursive":true}));
        assert_eq!(list_params("A/B/"), json!({"dir":"A/B","recursive":true}));
    }

    #[test]
    fn base64_rfc4648_vectors() {
        for (text, raw) in [("", ""), ("Zg==", "f"), ("Zm8=", "fo"), ("Zm9v", "foo"), ("Zm9vYg==", "foob"), ("Zm9vYmE=", "fooba"), ("Zm9vYmFy", "foobar")] {
            assert_eq!(base64_decode(text).unwrap(), raw.as_bytes(), "{text}");
        }
    }

    #[test]
    fn base64_binary_and_round_trip_bytes() {
        assert_eq!(base64_decode("/w==").unwrap(), vec![0xff]);
        assert_eq!(base64_decode("iVBORwD/EA==").unwrap(), vec![0x89, b'P', b'N', b'G', 0x00, 0xff, 0x10]);
        // Every byte value and every length mod 3, encoded by hand: the alphabet's 64 digits in order.
        let all: Vec<u8> = (0..=255).collect();
        let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut text = String::new();
        for chunk in all.chunks(3) {
            let n = chunk.iter().enumerate().fold(0u32, |acc, (i, b)| acc | ((*b as u32) << (16 - 8 * i)));
            for k in 0..4 {
                if k <= chunk.len() {
                    text.push(alphabet[((n >> (18 - 6 * k)) & 63) as usize] as char);
                } else {
                    text.push('=');
                }
            }
        }
        assert_eq!(base64_decode(&text).unwrap(), all);
    }

    #[test]
    fn base64_rejects_invalid_input() {
        for bad in [
            "Zg=",      // length not a multiple of 4
            "Zg==Zg==", // padding before the last quartet
            "Z===",     // three pad signs
            "=Zg=",     // padding in the wrong place
            "Zm9*",     // character outside the alphabet
            "Zm9 ",     // whitespace
            "Zh==",     // non-zero unused bits
        ] {
            assert!(base64_decode(bad).is_none(), "{bad} must be rejected");
        }
    }
}
