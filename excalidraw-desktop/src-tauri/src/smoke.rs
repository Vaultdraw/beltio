//! Optional packaged-app smoke bridge. This module is compiled only with `smoke-test`.
use serde_json::{json, Value};
use std::{env, fs, io::Write, path::PathBuf, sync::{atomic::{AtomicUsize, Ordering}, Mutex, OnceLock}};
use tauri::AppHandle;

const ENV_DIR: &str = "EXCALIDRAW_VAULT_SMOKE_DIR";
const ENV_DIR_ALT: &str = "EXCALIDRAW_VAULT_SMOKE_DIR_ALT";
static CHOOSE_CALLS: AtomicUsize = AtomicUsize::new(0);
static REPORT: OnceLock<Mutex<Vec<Value>>> = OnceLock::new();

fn report() -> &'static Mutex<Vec<Value>> {
    REPORT.get_or_init(|| Mutex::new(Vec::new()))
}

pub fn enabled() -> bool {
    env::var_os(ENV_DIR).is_some_and(|value| !value.is_empty())
}

/// Resolve only the explicit test folder; it is never inferred from cwd or app data.
pub fn test_dir() -> Result<PathBuf, String> {
    let value = env::var_os(ENV_DIR).ok_or_else(|| format!("{ENV_DIR} is not set"))?;
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(format!("{ENV_DIR} must be an absolute path"));
    }
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    if !path.is_dir() {
        return Err(format!("{ENV_DIR} must name a directory"));
    }
    path.canonicalize().map_err(|error| error.to_string())
}

/// Vault for the n-th `choose_vault` call: the test folder, or with EXCALIDRAW_VAULT_SMOKE_DIR_ALT set
/// alternating test folder (call 0, 2, ...) and alternate folder (call 1, 3, ...) so a perf run can switch vaults.
pub fn choose_dir() -> Result<PathBuf, String> {
    let call = CHOOSE_CALLS.fetch_add(1, Ordering::SeqCst);
    let alt = env::var_os(ENV_DIR_ALT).filter(|value| !value.is_empty()).map(PathBuf::from);
    match pick_dir(call, alt) {
        Some(path) => {
            if !path.is_absolute() {
                return Err(format!("{ENV_DIR_ALT} must be an absolute path"));
            }
            if !path.is_dir() {
                return Err(format!("{ENV_DIR_ALT} must name an existing directory"));
            }
            path.canonicalize().map_err(|error| error.to_string())
        }
        None => test_dir(),
    }
}

/// The alternate folder when this call should use it, else None (use the primary test folder).
fn pick_dir(call: usize, alt: Option<PathBuf>) -> Option<PathBuf> {
    alt.filter(|_| call % 2 == 1)
}

/// Resolve the export sandbox after canonicalizing it so a symlink cannot escape the test folder.
pub fn export_dir() -> Result<PathBuf, String> {
    let root = test_dir()?;
    let path = root.join("smoke-exports");
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    let resolved = path.canonicalize().map_err(|error| error.to_string())?;
    if !resolved.starts_with(&root) || !resolved.is_dir() {
        return Err("smoke export directory escaped the configured test folder".into());
    }
    Ok(resolved)
}

#[tauri::command]
pub fn smoke_environment() -> Result<Value, String> {
    let root = test_dir()?;
    // VAULTDRAW_PERF_SUITE selects a perf suite (e.g. "refresh-rate"); empty = the full run.
    // VAULTDRAW_PERF_DRAWINGS: extra probe drawings, JSON [{ path, pattern, elements }].
    let perf_suite = env::var("VAULTDRAW_PERF_SUITE").unwrap_or_default();
    let perf_drawings = env::var("VAULTDRAW_PERF_DRAWINGS").unwrap_or_default();
    Ok(json!({ "enabled": true, "vaultPath": root.to_string_lossy(), "exportPath": root.join("smoke-exports").to_string_lossy(), "perfSuite": perf_suite, "perfDrawings": perf_drawings, "hiddenRender": hidden_render(), "watchdogSmoke": crate::watchdog::smoke_requested() }))
}

#[tauri::command]
pub fn smoke_log(step: String, ok: bool, details: Option<Value>) -> Result<(), String> {
    // "~label" entries are progress marks: appended to smoke-progress.log
    // right away (so a hung run can be diagnosed) and kept out of the report.
    if let Some(label) = step.strip_prefix('~') {
        use std::io::Write;
        let path = test_dir()?.join("smoke-progress.log");
        let mut file = fs::OpenOptions::new().create(true).append(true).open(path).map_err(|e| e.to_string())?;
        let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        writeln!(file, "{ms} {label}").map_err(|e| e.to_string())?;
        return Ok(());
    }
    let record = json!({ "step": step, "ok": ok, "details": details });
    // Live line for external runners; one line per record, flushed immediately.
    {
        let stdout = std::io::stdout();
        let mut out = stdout.lock();
        let _ = writeln!(out, "VAULTDRAW_SMOKE_LOG {record}");
        let _ = out.flush();
    }
    report().lock().map_err(|_| "smoke report lock poisoned".to_string())?.push(record);
    Ok(())
}

#[tauri::command]
pub fn smoke_finish(app: AppHandle, status: i32, details: Option<Value>) -> Result<(), String> {
    let root = test_dir()?;
    let steps = report().lock().map_err(|_| "smoke report lock poisoned".to_string())?.clone();
    let report = json!({ "status": status, "steps": steps, "details": details });
    let path = root.join("smoke-report.json");
    if let Ok(metadata) = fs::symlink_metadata(&path) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("smoke-report.json must be a regular file, not a symlink".into());
        }
    }
    fs::write(path, serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    app.exit(status);
    Ok(())
}


/// Pids of this app and its WebKit helper processes (WKWebView private API), for exact perf attribution.
#[cfg(target_os = "macos")]
pub(crate) fn webkit_pids(ptr: *mut std::ffi::c_void) -> (Option<i32>, Option<i32>, Option<i32>) {
    use objc2::runtime::AnyObject;
    use objc2::{msg_send, sel};
    if ptr.is_null() {
        return (None, None, None);
    }
    // SAFETY: ptr is the live WKWebView handed out by wry on the main thread; every private
    // selector is guarded with respondsToSelector before it is sent.
    unsafe {
        let view: &AnyObject = &*(ptr as *mut AnyObject);
        let responds = |obj: &AnyObject, sel: objc2::runtime::Sel| -> bool {
            msg_send![obj, respondsToSelector: sel]
        };
        let positive = |pid: i32| if pid > 0 { Some(pid) } else { None };
        let mut web = None;
        let mut network = None;
        let mut gpu = None;
        if responds(view, sel!(_webProcessIdentifier)) {
            let pid: i32 = msg_send![view, _webProcessIdentifier];
            web = positive(pid);
        }
        if responds(view, sel!(_gpuProcessIdentifier)) {
            let pid: i32 = msg_send![view, _gpuProcessIdentifier];
            gpu = positive(pid);
        }
        let config: *mut AnyObject = msg_send![view, configuration];
        if !config.is_null() {
            let pool: *mut AnyObject = msg_send![&*config, processPool];
            if !pool.is_null() {
                let pool: &AnyObject = &*pool;
                if responds(pool, sel!(_networkProcessIdentifier)) {
                    let pid: i32 = msg_send![pool, _networkProcessIdentifier];
                    network = positive(pid);
                }
                if gpu.is_none() && responds(pool, sel!(_gpuProcessIdentifier)) {
                    let pid: i32 = msg_send![pool, _gpuProcessIdentifier];
                    gpu = positive(pid);
                }
            }
        }
        (web, network, gpu)
    }
}

/// Async so the main thread stays free to run the with_webview closure.
#[tauri::command]
pub async fn perf_process_ids(window: tauri::WebviewWindow) -> Result<Value, String> {
    let (tx, rx) = std::sync::mpsc::channel::<(Option<i32>, Option<i32>, Option<i32>)>();
    #[cfg(target_os = "macos")]
    window
        .with_webview(move |webview| {
            let _ = tx.send(webkit_pids(webview.inner()));
        })
        .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (&window, tx);
    }
    let (web, network, gpu) = rx
        .recv_timeout(std::time::Duration::from_secs(5))
        .unwrap_or((None, None, None));
    Ok(json!({ "app": std::process::id(), "webContent": web, "network": network, "gpu": gpu }))
}

/// Memory diagnosis only (`VAULTDRAW_PERF_LAYER_DIR=<dir>`): writes the WKWebView's UI-side layer
/// tree (`_caLayerTreeAsText`, a WebKit testing selector, guarded) to `<dir>/<label>.txt`.
/// Returns false when the variable is unset, so the caller stops asking.
#[tauri::command]
pub async fn perf_layer_tree(window: tauri::WebviewWindow, label: String, dom: Option<String>) -> Result<bool, String> {
    let Some(dir) = env::var_os("VAULTDRAW_PERF_LAYER_DIR").filter(|d| !d.is_empty()) else {
        return Ok(false);
    };
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    #[cfg(target_os = "macos")]
    window
        .with_webview(move |webview| {
            use objc2::runtime::AnyObject;
            use objc2::msg_send;
            use objc2_foundation::NSString;
            let ptr = webview.inner();
            let mut out = String::new();
            if !ptr.is_null() {
                // SAFETY: live WKWebView from wry on the main thread; selectors guarded.
                unsafe {
                    let view: &AnyObject = &*(ptr as *mut AnyObject);
                    for name in ["_caLayerTreeAsText", "_scrollingTreeAsText"] {
                        let s = objc2::runtime::Sel::register(&std::ffi::CString::new(name).unwrap());
                        let responds: bool = msg_send![view, respondsToSelector: s];
                        if !responds {
                            out.push_str(&format!("== {name}: not available\n"));
                            continue;
                        }
                        let text: *mut NSString = if name == "_caLayerTreeAsText" {
                            msg_send![view, _caLayerTreeAsText]
                        } else {
                            msg_send![view, _scrollingTreeAsText]
                        };
                        let text = if text.is_null() { String::new() } else { (*text).to_string() };
                        out.push_str(&format!("== {name}\n{text}\n"));
                    }
                }
            }
            let _ = tx.send(out);
        })
        .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (&window, &tx);
    }
    let mut text = rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap_or_default();
    if let Some(dom) = dom {
        text.push_str("== dom census\n");
        text.push_str(&dom);
    }
    let safe: String = label.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' }).collect();
    let path = PathBuf::from(dir).join(format!("{}-{safe}.txt", std::process::id()));
    fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Memory diagnosis: `[pid, phys_footprint, lifetime max phys_footprint]` in bytes per pid
/// (`proc_pid_rusage`, microseconds per call, so the page can sample it every few ms).
#[tauri::command]
pub fn perf_footprint(pids: Vec<i32>) -> Vec<[u64; 3]> {
    #[cfg(target_os = "macos")]
    {
        extern "C" {
            fn proc_pid_rusage(pid: i32, flavor: i32, buffer: *mut u8) -> i32;
        }
        const RUSAGE_INFO_V4: i32 = 4;
        let field = |buf: &[u8], at: usize| u64::from_le_bytes(buf[at..at + 8].try_into().unwrap());
        pids.into_iter()
            .filter_map(|pid| {
                let mut buf = [0u8; 512];
                // SAFETY: the buffer is larger than rusage_info_v4 (296 bytes).
                let rc = unsafe { proc_pid_rusage(pid, RUSAGE_INFO_V4, buf.as_mut_ptr()) };
                // ri_phys_footprint at 72, ri_lifetime_max_phys_footprint at 240.
                (rc == 0).then(|| [pid as u64, field(&buf, 72), field(&buf, 240)])
            })
            .collect()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = pids;
        Vec::new()
    }
}

/// A smoke or perf run (as opposed to the smoke-test build launched by hand).
pub fn test_run() -> bool {
    enabled() || env::var("VAULTDRAW_PERF").ok().as_deref() == Some("1")
}

/// `VAULTDRAW_SMOKE_FOREGROUND=1`: the test run opens as a normal, focused app, for window
/// managers that keep a never-activated window off the visible workspace (the WebView then
/// reports hidden and the smoke refuses to start).
pub fn foreground_test() -> bool {
    env::var("VAULTDRAW_SMOKE_FOREGROUND").ok().as_deref() == Some("1") || perf_foreground()
}

/// `VAULTDRAW_PERF_FOREGROUND=1` (perf `--foreground`): a normal foreground app WITHOUT the
/// hidden-rendering hardening, to measure what a user's app holds (rendering while hidden
/// inflates the idle footprint). Opt-in; default unchanged.
pub fn perf_foreground() -> bool {
    env::var("VAULTDRAW_PERF_FOREGROUND").ok().as_deref() == Some("1")
}

/// Test runs that try to keep rendering while hidden: background runs (not `--foreground`).
pub fn hidden_render() -> bool {
    test_run() && !perf_foreground()
}

/// A test run that stays in the background (the default for smoke and perf runs).
pub fn background_test() -> bool {
    test_run() && !foreground_test()
}

/// Test runs stay in the background: no Dock icon, never the active app. A window manager
/// then has no activation to follow, so test windows never pull the user to another workspace.
pub fn background_test_app(app: &mut tauri::App) {
    #[cfg(target_os = "macos")]
    if background_test() {
        app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// Test runs only: keep the WebView rendering while the window is hidden (another workspace,
/// occluded, screen locked), and keep the process out of App Nap. Never takes focus.
/// Every private selector is guarded.
pub fn harden_test_webview(window: &tauri::WebviewWindow) {
    if !hidden_render() {
        return;
    }
    #[cfg(target_os = "macos")]
    {
        let _ = window.with_webview(|webview| unsafe {
            use objc2::runtime::{AnyObject, Bool, Sel};
            use objc2::{msg_send, sel};
            let ptr = webview.inner();
            if !ptr.is_null() {
                let view: &AnyObject = &*(ptr as *mut AnyObject);
                let responds = |obj: &AnyObject, sel: Sel| -> bool {
                    msg_send![obj, respondsToSelector: sel]
                };
                if responds(view, sel!(_setWindowOcclusionDetectionEnabled:)) {
                    let _: () = msg_send![view, _setWindowOcclusionDetectionEnabled: Bool::NO];
                }
                let config: *mut AnyObject = msg_send![view, configuration];
                if !config.is_null() {
                    let prefs: *mut AnyObject = msg_send![&*config, preferences];
                    if !prefs.is_null() {
                        let prefs: &AnyObject = &*prefs;
                        if responds(prefs, sel!(_setHiddenPageDOMTimerThrottlingEnabled:)) {
                            let _: () = msg_send![prefs, _setHiddenPageDOMTimerThrottlingEnabled: Bool::NO];
                        }
                        if responds(prefs, sel!(_setPageVisibilityBasedProcessSuppressionEnabled:)) {
                            let _: () = msg_send![prefs, _setPageVisibilityBasedProcessSuppressionEnabled: Bool::NO];
                        }
                    }
                }
            }
            // Hold an activity token for the life of the process: no App Nap. Not latency-critical:
            // that flag disables timer coalescing and would inflate the idle CPU measurement.
            let info: *mut AnyObject = msg_send![objc2::class!(NSProcessInfo), processInfo];
            if !info.is_null() {
                let reason = objc2_foundation::NSString::from_str("perf run");
                const USER_INITIATED: u64 = 0x00FF_FFFF;
                let token: *mut AnyObject = msg_send![
                    &*info,
                    beginActivityWithOptions: USER_INITIATED,
                    reason: &*reason
                ];
                if !token.is_null() {
                    let _: *mut AnyObject = msg_send![&*token, retain];
                }
            }
        });
    }
}

/// PDF the import command opens instead of a file dialog (env override, else `<test dir>/smoke.pdf`).
pub fn pdf_import_path() -> Result<PathBuf, String> {
    match env::var_os("VAULTDRAW_SMOKE_PDF") {
        Some(p) if !p.is_empty() => Ok(PathBuf::from(p)),
        _ => Ok(test_dir()?.join("smoke.pdf")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alternates_only_when_alt_is_set() {
        let alt = Some(PathBuf::from("/alt"));
        assert_eq!(pick_dir(0, alt.clone()), None);
        assert_eq!(pick_dir(1, alt.clone()), Some(PathBuf::from("/alt")));
        assert_eq!(pick_dir(2, alt.clone()), None);
        assert_eq!(pick_dir(3, alt), Some(PathBuf::from("/alt")));
        for call in 0..4 {
            assert_eq!(pick_dir(call, None), None);
        }
    }
}
