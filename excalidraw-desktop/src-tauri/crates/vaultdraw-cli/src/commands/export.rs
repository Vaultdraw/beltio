//! `vaultdraw export`: the app renders a drawing (PNG, SVG or PDF) and the bytes come back
//! base64 encoded; this writes them to a file or stdout. Needs the running app (no offline path).

use super::target;
use crate::cli::{Cli, ExportArgs};
use crate::error::{Fail, EXIT_PROTOCOL};
use crate::rpc::{request_line, resolve_socket, Rpc};
use serde_json::{json, Value};
use std::io::{IsTerminal, Write};
use std::path::{Path, PathBuf};
use vaultdraw_protocol::methods;

/// The app waits up to 120 s for a render (`EXPORT_TIMEOUT`); the CLI must wait at least as long.
const REPLY_WAIT_SECS: u64 = 125;

pub fn run(cli: &Cli, args: &ExportArgs) -> Result<(), Fail> {
    let format = args.format.clone().or_else(|| args.out.as_deref().and_then(format_of_ext)).unwrap_or_else(|| "png".into());
    let mut p = target(cli, &args.target);
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
    let params = Value::Object(p);
    if cli.print_request {
        println!("{}", request_line(methods::EXPORT_RENDER, Some(params)));
        return Ok(());
    }
    let to_stdout = args.out.as_deref() == Some("-");
    if to_stdout && cli.json {
        return Err(Fail::cli("--json cannot be combined with -o - (stdout carries the file's bytes)"));
    }
    if to_stdout && !args.force && std::io::stdout().is_terminal() {
        return Err(Fail::cli("refusing to write binary output to a terminal (redirect it, use -o <file>, or pass --force)"));
    }
    // Fail before the render when the target is known and taken.
    if let Some(out) = args.out.as_deref().filter(|o| *o != "-") {
        check_free(Path::new(out), args.force)?;
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
        let dest = match args.out.as_deref() {
            Some(out) => PathBuf::from(out),
            None => PathBuf::from(safe_name(&file_name)?),
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

/// `png`, `svg` or `pdf` from a file extension (case-insensitive).
fn format_of_ext(out: &str) -> Option<String> {
    let ext = Path::new(out).extension()?.to_str()?.to_ascii_lowercase();
    matches!(ext.as_str(), "png" | "svg" | "pdf").then_some(ext)
}

/// The reply's bytes, decoded and checked against its `size`.
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

fn check_free(dest: &Path, force: bool) -> Result<(), Fail> {
    if !force && dest.exists() {
        return Err(Fail::cli(format!("{} already exists (use --force to overwrite it)", dest.display())));
    }
    Ok(())
}

/// Writes to `<dest>.tmp-<pid>` and renames it into place, so a failed write leaves no partial file.
fn write_file(dest: &Path, bytes: &[u8], force: bool) -> Result<(), Fail> {
    check_free(dest, force)?;
    let tmp = PathBuf::from(format!("{}.tmp-{}", dest.display(), std::process::id()));
    let fail = |what: &str, e: std::io::Error| {
        let _ = std::fs::remove_file(&tmp);
        Fail::cli(format!("cannot {what} {}: {e}", dest.display()))
    };
    std::fs::write(&tmp, bytes).map_err(|e| fail("write", e))?;
    // Re-check after the render: another process may have created the file meanwhile.
    if let Err(f) = check_free(dest, force) {
        let _ = std::fs::remove_file(&tmp);
        return Err(f);
    }
    std::fs::rename(&tmp, dest).map_err(|e| fail("write", e))
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
