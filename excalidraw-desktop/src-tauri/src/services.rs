//! Lazy start of the per-vault services (D8): `open_vault` only registers search and
//! history; the webview starts each one per its `start` mode (`open`, `idle`, `use`), and
//! any query that needs a pending service starts it first (`SearchService::vault`,
//! `HistoryService::vault`).

use crate::{err, history, links, search, Result};
use tauri::State;

/// One service of `services_start`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Service {
    Search,
    /// Search plus the link index built from it, ready before the first links query.
    Links,
    History,
}

impl Service {
    pub(crate) fn parse(name: &str) -> Option<Service> {
        match name {
            "search" => Some(Service::Search),
            "links" => Some(Service::Links),
            "history" => Some(Service::History),
            _ => None,
        }
    }
}

/// Starts `service` for `handle` now if it is still pending. Idempotent.
pub(crate) fn start(service: Service, handle: &str, search: &search::SearchService, history: &history::HistoryService) {
    match service {
        Service::Search => search.ensure(handle),
        Service::Links => {
            if let Ok(vi) = search.vault(handle) {
                links::prewarm(vi);
            }
        }
        Service::History => history.ensure(handle),
    }
}

#[tauri::command]
#[cfg_attr(test, allow(dead_code))]
pub(crate) async fn services_start(
    handle: String,
    service: String,
    search: State<'_, search::SearchService>,
    history: State<'_, history::HistoryService>,
) -> Result<()> {
    let service = Service::parse(&service).ok_or_else(|| err("INVALID_ARGUMENT", "Service must be search, links or history"))?;
    start(service, &handle, &search, &history);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_three_services_only() {
        assert_eq!(Service::parse("search"), Some(Service::Search));
        assert_eq!(Service::parse("links"), Some(Service::Links));
        assert_eq!(Service::parse("history"), Some(Service::History));
        assert_eq!(Service::parse("graph"), None);
        assert_eq!(Service::parse(""), None);
    }

    #[test]
    fn links_start_starts_search_and_builds_the_link_index() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.excalidraw"), r#"{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}"#).unwrap();
        let search = search::SearchService::default();
        search.register_with("h", dir.path().to_path_buf(), std::sync::Arc::new(|_| {}), None);
        let history = history::HistoryService::hard_off_for_tests(dir.path().join("state"));
        start(Service::Links, "h", &search, &history);
        assert!(!search.is_pending("h"));
        let vi = search.vault("h").unwrap();
        for _ in 0..400 {
            if vi.read().links().is_some() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        panic!("link index was not pre-built");
    }

    fn cpu_ms() -> f64 {
        // SAFETY: getrusage fills a plain struct for this process.
        let mut u: libc::rusage = unsafe { std::mem::zeroed() };
        unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut u) };
        let t = |v: libc::timeval| v.tv_sec as f64 * 1000.0 + v.tv_usec as f64 / 1000.0;
        t(u.ru_utime) + t(u.ru_stime)
    }

    fn rss_mb() -> f64 {
        std::process::Command::new("ps")
            .args(["-o", "rss=", "-p", &std::process::id().to_string()])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .and_then(|s| s.trim().parse::<f64>().ok())
            .map_or(0.0, |kb| kb / 1024.0)
    }

    /// Startup work of one vault open, eager (`start = "open"`, the old behaviour) vs
    /// registered (`idle`/`use`): CPU time and RSS growth in the first `WINDOW` after open,
    /// cold (no snapshot) and warm (snapshot present). Ignored by default:
    /// `cargo test --release bench_open_startup_work -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn bench_open_startup_work() {
        const WINDOW: std::time::Duration = std::time::Duration::from_millis(1500);
        let count: usize = std::env::var("BENCH_DRAWINGS").ok().and_then(|v| v.parse().ok()).unwrap_or(1000);
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("vault");
        let (bytes, _) = vaultdraw_core::search::testgen::generate(&root, count);
        println!("vault: {count} drawings, {:.1} MB", bytes as f64 / 1e6);
        let snap = dir.path().join("state/index.bin");
        let history = history::HistoryService::hard_off_for_tests(dir.path().join("hstate"));
        for (label, warm) in [("cold", false), ("warm", true)] {
            if !warm {
                let _ = std::fs::remove_file(&snap);
            }
            for eager in [true, false] {
                let svc = search::SearchService::default();
                let (c0, r0, t0) = (cpu_ms(), rss_mb(), std::time::Instant::now());
                svc.register_with("h", root.clone(), std::sync::Arc::new(|_| {}), Some(snap.clone()));
                if eager {
                    start(Service::Search, "h", &svc, &history);
                }
                std::thread::sleep(WINDOW);
                let (cpu, rss) = (cpu_ms() - c0, rss_mb() - r0);
                let ready = if eager {
                    while !svc.status("h").is_ok_and(|s| s.state == search::IndexState::Ready) {
                        std::thread::sleep(std::time::Duration::from_millis(10));
                    }
                    format!("{:.0} ms", t0.elapsed().as_secs_f64() * 1000.0)
                } else {
                    "-".into()
                };
                println!("{label} {:<6} first {}ms: cpu {cpu:.0} ms, rss +{rss:.1} MB, ready at {ready}", if eager { "open" } else { "lazy" }, WINDOW.as_millis());
                svc.stop("h");
                std::thread::sleep(std::time::Duration::from_millis(300));
            }
            // Leave a snapshot for the warm round.
            let svc = search::SearchService::default();
            svc.start_with("h", root.clone(), std::sync::Arc::new(|_| {}), Some(snap.clone()));
            while !svc.status("h").is_ok_and(|s| s.state == search::IndexState::Ready) {
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            std::thread::sleep(std::time::Duration::from_secs(6)); // snapshot save is debounced 5 s
            svc.stop("h");
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
    }
}

