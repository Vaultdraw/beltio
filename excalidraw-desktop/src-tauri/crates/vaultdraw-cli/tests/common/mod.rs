#![allow(dead_code)]
//! A fake control server (Unix socket, NDJSON) and a runner for the built binary.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;
use std::path::PathBuf;
use std::process::{Command, Output};
use std::sync::{Arc, Mutex};

/// Answers each request with `handler(method, params)`; records every request line.
pub struct Fake {
    pub dir: PathBuf,
    pub socket: PathBuf,
    pub seen: Arc<Mutex<Vec<Value>>>,
}

type Reply = Result<Value, (i64, String, Option<&'static str>)>;

/// Lines pushed after a reply: notifications, or the string "CLOSE" to end the connection.
pub type Pushes = Vec<Value>;

impl Fake {
    pub fn start(handler: impl Fn(&str, &Value) -> Reply + Send + Sync + 'static) -> Self {
        Self::start_with_pushes(handler, |_, _| vec![])
    }

    /// Like `start`, and `pushes(method, params)` lists the notifications written right after
    /// that reply (an event stream).
    pub fn start_with_pushes(
        handler: impl Fn(&str, &Value) -> Reply + Send + Sync + 'static,
        pushes: impl Fn(&str, &Value) -> Pushes + Send + Sync + 'static,
    ) -> Self {
        let pushes = Arc::new(pushes);
        // Short path: sun_path is 104 bytes on macOS.
        let dir = std::env::temp_dir().join(format!("vd-{}-{}", std::process::id(), next()));
        let dir = PathBuf::from("/tmp").join(dir.file_name().unwrap());
        std::fs::create_dir_all(&dir).unwrap();
        let socket = dir.join("c.sock");
        let listener = UnixListener::bind(&socket).unwrap();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let seen2 = seen.clone();
        let handler = Arc::new(handler);
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { break };
                let (handler, seen2, pushes) = (handler.clone(), seen2.clone(), pushes.clone());
                std::thread::spawn(move || {
                let mut w = stream.try_clone().unwrap();
                for line in BufReader::new(stream).lines() {
                    let Ok(line) = line else { break };
                    let req: Value = serde_json::from_str(&line).unwrap();
                    seen2.lock().unwrap().push(req.clone());
                    let method = req["method"].as_str().unwrap_or("").to_string();
                    let reply = match handler(&method, &req["params"]) {
                        Ok(r) => json!({"jsonrpc":"2.0","id":req["id"],"result":r}),
                        Err((code, msg, data)) => {
                            let mut e = json!({"code": code, "message": msg});
                            if let Some(d) = data {
                                e["data"] = json!({"code": d});
                            }
                            json!({"jsonrpc":"2.0","id":req["id"],"error":e})
                        }
                    };
                    if writeln!(w, "{reply}").is_err() {
                        break;
                    }
                    for push in pushes(&method, &req["params"]) {
                        if push == "CLOSE" {
                            let _ = w.shutdown(std::net::Shutdown::Both);
                            return;
                        }
                        let _ = writeln!(w, "{push}");
                    }
                }
                });
            }
        });
        Self { dir, socket, seen }
    }
}

impl Drop for Fake {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn next() -> u64 {
    static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

/// Runs the binary with a clean environment (no user dirs touched).
pub fn vd(args: &[&str], socket: Option<&PathBuf>, state: Option<&PathBuf>) -> Output {
    vd_in(args, socket, state, "")
}

/// Like `vd`, with `stdin` piped in.
pub fn vd_in(args: &[&str], socket: Option<&PathBuf>, state: Option<&PathBuf>, stdin: &str) -> Output {
    use std::process::Stdio;
    let mut c = Command::new(env!("CARGO_BIN_EXE_vaultdraw-cli"));
    c.args(args).env_clear().env("HOME", "/nonexistent-vd-home");
    match socket {
        Some(s) => c.arg("--socket").arg(s),
        None => c.env("VAULTDRAW_RUNTIME_DIR", "/tmp/vd-none-runtime"),
    };
    c.env("VAULTDRAW_STATE_DIR", state.cloned().unwrap_or_else(|| "/tmp/vd-none-state".into()));
    let mut child = c.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    let _ = child.stdin.take().unwrap().write_all(stdin.as_bytes());
    child.wait_with_output().unwrap()
}

pub fn out(o: &Output) -> String {
    String::from_utf8_lossy(&o.stdout).into_owned()
}
pub fn err(o: &Output) -> String {
    String::from_utf8_lossy(&o.stderr).into_owned()
}
pub fn code(o: &Output) -> i32 {
    o.status.code().unwrap_or(-1)
}

pub fn status_result() -> Value {
    json!({"running":true,"app":"0.9.0","api":1,"pid":4242,
        "vault":{"name":"DSA","path":"/v/DSA","readOnly":false},
        "activeDrawing":{"path":"Graphs/BFS.excalidraw","dirty":true},"tabs":3,"windowReady":true})
}
