//! Newline-delimited JSON framing with a size cap. A frame is one UTF-8 JSON value on one
//! line; serde_json never emits raw newlines, so `\n` is an unambiguous delimiter.

use std::io::{self, BufRead, Write};

#[derive(Debug)]
pub enum FrameError {
    Io(io::Error),
    /// The line exceeded the cap; the rest of it was discarded.
    TooLarge,
}

impl From<io::Error> for FrameError {
    fn from(e: io::Error) -> Self {
        Self::Io(e)
    }
}

impl std::fmt::Display for FrameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "{e}"),
            Self::TooLarge => write!(f, "message exceeds {} bytes", crate::MAX_FRAME_BYTES),
        }
    }
}

/// Reads one frame (without the trailing newline). `Ok(None)` at a clean EOF.
/// A final line without a newline is still returned. Blank lines are skipped.
pub fn read_frame(r: &mut impl BufRead, max: usize) -> Result<Option<Vec<u8>>, FrameError> {
    let mut out = Vec::new();
    loop {
        let (done, used) = {
            let buf = match r.fill_buf() {
                Ok(b) => b,
                Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                Err(e) => return Err(e.into()),
            };
            if buf.is_empty() {
                return Ok(if out.is_empty() { None } else { Some(out) });
            }
            match memchr_nl(buf) {
                Some(i) => {
                    if out.len() + i > max {
                        (Some(Err(())), i + 1)
                    } else {
                        out.extend_from_slice(&buf[..i]);
                        (Some(Ok(())), i + 1)
                    }
                }
                None => {
                    if out.len() + buf.len() > max {
                        // Keep discarding until the newline, then report.
                        out.clear();
                        out.shrink_to_fit();
                        let n = buf.len();
                        r.consume(n);
                        return discard_rest(r).and(Err(FrameError::TooLarge));
                    }
                    out.extend_from_slice(buf);
                    (None, buf.len())
                }
            }
        };
        r.consume(used);
        match done {
            Some(Ok(())) => {
                if out.iter().all(u8::is_ascii_whitespace) {
                    out.clear();
                    continue;
                }
                return Ok(Some(out));
            }
            Some(Err(())) => return Err(FrameError::TooLarge),
            None => {}
        }
    }
}

fn discard_rest(r: &mut impl BufRead) -> Result<(), FrameError> {
    loop {
        let (found, n) = {
            let buf = r.fill_buf()?;
            if buf.is_empty() {
                return Ok(());
            }
            match memchr_nl(buf) {
                Some(i) => (true, i + 1),
                None => (false, buf.len()),
            }
        };
        r.consume(n);
        if found {
            return Ok(());
        }
    }
}

fn memchr_nl(b: &[u8]) -> Option<usize> {
    b.iter().position(|&c| c == b'\n')
}

/// Writes `value` as one line and flushes.
pub fn write_frame(w: &mut impl Write, value: &impl serde::Serialize) -> io::Result<()> {
    let mut bytes = serde_json::to_vec(value).map_err(io::Error::other)?;
    bytes.push(b'\n');
    w.write_all(&bytes)?;
    w.flush()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufReader, Cursor};

    #[test]
    fn a_largest_drawing_escaped_into_a_json_string_fits_one_frame() {
        // 32 MiB of quotes is the worst real case: every one is escaped to two bytes.
        let drawing = "\"".repeat(32 * 1024 * 1024);
        let mut line = serde_json::to_vec(&serde_json::json!({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"json": drawing}})).unwrap();
        assert!(line.len() > 64 * 1024 * 1024, "{}", line.len());
        line.push(b'\n');
        let mut r = BufReader::new(Cursor::new(line));
        let got = read_frame(&mut r, crate::MAX_FRAME_BYTES).expect("not too large").expect("a frame");
        assert!(got.len() < crate::MAX_FRAME_BYTES);
    }

    fn frames(input: &[u8], cap: usize, chunk: usize) -> Vec<Result<Vec<u8>, String>> {
        let mut r = BufReader::with_capacity(chunk, Cursor::new(input.to_vec()));
        let mut out = Vec::new();
        loop {
            match read_frame(&mut r, cap) {
                Ok(Some(f)) => out.push(Ok(f)),
                Ok(None) => break,
                Err(e) => out.push(Err(e.to_string())),
            }
        }
        out
    }

    #[test]
    fn splits_lines_across_small_buffers() {
        let got = frames(b"{\"a\":1}\n\n{\"b\":2}\n{\"c\":3}", 1024, 3);
        assert_eq!(got, vec![Ok(b"{\"a\":1}".to_vec()), Ok(b"{\"b\":2}".to_vec()), Ok(b"{\"c\":3}".to_vec())]);
    }

    #[test]
    fn oversized_line_is_rejected_and_stream_recovers() {
        let mut input = vec![b'x'; 100];
        input.extend_from_slice(b"\n{\"ok\":true}\n");
        for chunk in [4, 64, 1024] {
            let got = frames(&input, 50, chunk);
            assert_eq!(got.len(), 2, "chunk {chunk}");
            assert!(got[0].is_err());
            assert_eq!(got[1], Ok(b"{\"ok\":true}".to_vec()));
        }
    }

    #[test]
    fn invalid_utf8_is_passed_through_for_the_parser_to_reject() {
        let got = frames(b"\xff\xfe\n", 1024, 8);
        assert_eq!(got, vec![Ok(vec![0xff, 0xfe])]);
        assert!(serde_json::from_slice::<serde_json::Value>(&[0xff, 0xfe]).is_err());
    }

    #[test]
    fn write_frame_appends_one_newline() {
        let mut out = Vec::new();
        write_frame(&mut out, &serde_json::json!({"a": "x\ny"})).unwrap();
        assert_eq!(out, b"{\"a\":\"x\\ny\"}\n");
    }
}
