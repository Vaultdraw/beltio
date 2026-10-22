//! Realistic 5,000-drawing benchmark (ignored by default):
//! `cargo test --release bench_5k -- --ignored --nocapture`
//! Optionally under `taskpolicy -c background` for the low-end profile.

use super::*;
use std::{fs, path::Path, time::Duration};

use vaultdraw_core::search::testgen::generate as generate_n;

fn generate(root: &Path) -> (usize, usize) {
    generate_n(root, 5000)
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

fn pct(sorted: &[f64], p: f64) -> f64 {
    sorted[((sorted.len() as f64 * p).ceil() as usize).saturating_sub(1).min(sorted.len() - 1)]
}

fn wait_ready(svc: &SearchService) -> Option<Duration> {
    let t = Instant::now();
    let mut names_ready = None;
    loop {
        let s = svc.status("h").unwrap();
        if names_ready.is_none() && s.total == 5000 {
            names_ready = Some(t.elapsed());
        }
        if s.state == IndexState::Ready {
            return names_ready;
        }
        std::thread::sleep(Duration::from_millis(1));
    }
}

#[test]
#[ignore]
fn bench_5k() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("vault");
    let snap = dir.path().join("state/index/0123456789abcdef/index.bin");
    let t = Instant::now();
    let (json_bytes, with_blob) = generate(&root);
    let disk: u64 = walk_size(&root);
    println!("generated 5000 drawings in {:.1}s: {:.0} MB on disk ({} with 1-2 MB image blobs), JSON text {:.0} MB", t.elapsed().as_secs_f64(), disk as f64 / 1e6, with_blob, json_bytes as f64 / 1e6);

    // ---- cold build
    crate::memory::release_free_memory();
    let rss0 = rss_mb();
    let fp0 = crate::memory::footprint_bytes();
    let svc = SearchService::default();
    let t = Instant::now();
    svc.start_with("h", root.clone(), Arc::new(|_| {}), Some(snap.clone()));
    let names_ready = wait_ready(&svc);
    let cold = t.elapsed();
    let st = svc.status("h").unwrap();
    assert_eq!((st.indexed, st.total), (5000, 5000));
    let t2 = Instant::now();
    while !snap.exists() && t2.elapsed() < Duration::from_secs(30) {
        std::thread::sleep(Duration::from_millis(10));
    }
    let heap = svc.with_index("h", |i| i.approx_heap_bytes()).unwrap();
    let snap_bytes = fs::metadata(&snap).map(|m| m.len()).unwrap_or(0);
    let rss1 = rss_mb();
    let fp_raw = crate::memory::footprint_bytes();
    crate::memory::release_free_memory();
    let fp1 = crate::memory::footprint_bytes();

    // ---- queries
    let queries: Vec<(&str, &str)> = vec![
        ("single letter", "a"), ("single letter", "e"), ("single letter", "s"), ("single letter", "x"), ("single letter", "q"),
        ("prefix typing", "d"), ("prefix typing", "di"), ("prefix typing", "dij"), ("prefix typing", "dijk"), ("prefix typing", "dijks"), ("prefix typing", "dijkstra"),
        ("prefix typing", "gr"), ("prefix typing", "gra"), ("prefix typing", "grap"), ("prefix typing", "graph"),
        ("common word", "service"), ("common word", "the"), ("common word", "node"), ("common word", "auth"),
        ("multi-term", "dijkstra graph"), ("multi-term", "auth service flow"), ("multi-term", "shortest path dijkstra"), ("multi-term", "database migration deploy"),
        ("cjk", "数据库"), ("cjk", "认证"), ("cjk", "设计 流程"), ("cjk", "かふぇ"), ("cjk", "한국어"),
        ("accent", "cafe"), ("accent", "strasse"), ("accent", "ecole"),
        ("no match", "zzzzqq"), ("no match", "qqqqxx yy"), ("no match", "dijkstra zzzzqq"),
        ("file name", "sub7"), ("file name", "work"),
    ];
    let mut rows = Vec::new();
    let mut worst95: f64 = 0.0;
    for (kind, q) in &queries {
        let mut times = Vec::new();
        let mut total = 0;
        for _ in 0..20 {
            let t = Instant::now();
            let r = svc.search("h", q, None, None).unwrap();
            times.push(t.elapsed().as_secs_f64() * 1000.0);
            total = r.total_matches;
        }
        times.sort_by(f64::total_cmp);
        worst95 = worst95.max(pct(&times, 0.95));
        rows.push((*kind, *q, total, pct(&times, 0.5), pct(&times, 0.95), *times.last().unwrap()));
    }
    // scope=names (quick switcher)
    for q in ["a", "work", "design 1"] {
        let mut times = Vec::new();
        let mut total = 0;
        for _ in 0..20 {
            let t = Instant::now();
            total = svc.search("h", q, None, Some("names")).unwrap().total_matches;
            times.push(t.elapsed().as_secs_f64() * 1000.0);
        }
        times.sort_by(f64::total_cmp);
        rows.push(("names scope", q, total, pct(&times, 0.5), pct(&times, 0.95), *times.last().unwrap()));
    }
    // tag queries and the tag summary (F6; budget 5 ms)
    let mut tag_rows = Vec::new();
    for q in ["tag:#dsa", "tag:#dsa/graphs", "tag:#interview tag:#dsa", "graph tag:#dsa", "tag:#CAFÉ", "tag:#数据库", "tag:#nope", "dijkstra tag:#todo"] {
        let mut times = Vec::new();
        let mut total = 0;
        for _ in 0..20 {
            let t = Instant::now();
            total = svc.search("h", q, None, None).unwrap().total_matches;
            times.push(t.elapsed().as_secs_f64() * 1000.0);
        }
        times.sort_by(f64::total_cmp);
        tag_rows.push((q, total, pct(&times, 0.5), pct(&times, 0.95)));
    }
    let mut times = Vec::new();
    let mut summary = svc.tags("h").unwrap();
    for _ in 0..20 {
        let t = Instant::now();
        summary = svc.tags("h").unwrap();
        times.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    times.sort_by(f64::total_cmp);
    let summary_p95 = pct(&times, 0.95);
    svc.stop("h");
    std::thread::sleep(Duration::from_millis(300));

    // ---- warm start (snapshot older than every file's mtime? no: files are OLDER than the snapshot)
    let t = Instant::now();
    let warm_svc = SearchService::default();
    warm_svc.start_with("h", root.clone(), Arc::new(|_| {}), Some(snap.clone()));
    wait_ready(&warm_svc);
    let warm = t.elapsed();
    let st = warm_svc.status("h").unwrap();
    assert_eq!((st.indexed, st.total), (5000, 5000));
    let hits = warm_svc.search("h", "dijkstra", None, None).unwrap().total_matches;

    println!("\n=== bench_5k ===");
    println!("cold build to ready          : {:>8.0} ms  (all 5000 names searchable after {:?})", cold.as_secs_f64() * 1000.0, names_ready);
    println!("warm start (load + stat walk): {:>8.0} ms  (dijkstra matches {hits})", warm.as_secs_f64() * 1000.0);
    println!("index heap (approx)          : {:>8.1} MB", heap as f64 / 1e6);
    println!("snapshot size                : {:>8.1} MB", snap_bytes as f64 / 1e6);
    println!("footprint before build / after build / after relief: {:.1} / {:.1} / {:.1} MB (index cost {:.1} MB)", fp0 as f64 / 1048576.0, fp_raw as f64 / 1048576.0, fp1 as f64 / 1048576.0, (fp1 as f64 - fp0 as f64) / 1048576.0);
    println!("process RSS before/after cold: {rss0:.0} / {rss1:.0} MB (test binary, includes allocator slack)");
    println!("\n{:<14} {:<26} {:>8} {:>9} {:>9} {:>9}", "kind", "query", "matches", "p50 ms", "p95 ms", "max ms");
    for (kind, q, total, p50, p95, max) in &rows {
        println!("{kind:<14} {q:<26} {total:>8} {p50:>9.3} {p95:>9.3} {max:>9.3}");
    }
    let all_p95: Vec<f64> = rows.iter().map(|r| r.4).collect();
    println!("\nworst per-query p95: {worst95:.3} ms over {} queries x 20 runs (budget 50 ms)   mean p95 {:.3} ms", rows.len(), all_p95.iter().sum::<f64>() / all_p95.len() as f64);
    println!("\n{:<26} {:>8} {:>9} {:>9}", "tag query", "matches", "p50 ms", "p95 ms");
    for (q, total, p50, p95) in &tag_rows {
        println!("{q:<26} {total:>8} {p50:>9.3} {p95:>9.3}");
    }
    println!("tag summary (vault_tags): {} tags, {} tagged drawings, p50 {:.3} ms p95 {summary_p95:.3} ms", summary.summary.tags.len(), summary.summary.by_path.len(), pct(&times, 0.5));
    let worst_tag = tag_rows.iter().map(|r| r.3).fold(0.0, f64::max).max(summary_p95);
    assert!(worst_tag < 5.0, "tag query budget broken: {worst_tag}");
    assert!(worst95 < 50.0, "query p95 budget broken: {worst95}");
}

fn walk_size(root: &Path) -> u64 {
    super::walk(root, "").iter().map(|f| f.size).sum()
}

/// Where does the process footprint go while building the index? (`--ignored --nocapture`)
#[test]
#[ignore]
fn bench_footprint_stages() {
    let mb = |b: u64| b as f64 / 1048576.0;
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("vault");
    generate(&root);
    crate::memory::release_free_memory();
    let fp0 = crate::memory::footprint_bytes();
    let found = super::walk(&root, "");
    let mut idx = Index::default();
    for f in &found {
        let items = match crate::read_bounded(&root.join(&f.path), crate::MAX_DRAWING_BYTES) {
            Ok(bytes) => extract_items(&bytes).unwrap_or_default(),
            Err(_) => Vec::new(),
        };
        idx.upsert(f.path.clone(), index::DocEntry::new(&f.path, (f.size, f.mtime), items));
    }
    let fp1 = crate::memory::footprint_bytes();
    crate::memory::release_free_memory();
    let fp2 = crate::memory::footprint_bytes();
    let snap = dir.path().join("s/index.bin");
    store::save(&snap, 1, &idx).unwrap();
    let fp3 = crate::memory::footprint_bytes();
    crate::memory::release_free_memory();
    let fp4 = crate::memory::footprint_bytes();
    drop(idx);
    let loaded = store::load(&snap).unwrap().1;
    let fp5 = crate::memory::footprint_bytes();
    crate::memory::release_free_memory();
    let fp6 = crate::memory::footprint_bytes();
    println!(
        "approx heap {:.1} MB | MB over baseline: built {:.1}, relief {:.1}, saved {:.1}, relief {:.1}, reloaded {:.1}, relief {:.1}",
        loaded.approx_heap_bytes() as f64 / 1048576.0,
        mb(fp1.saturating_sub(fp0)), mb(fp2.saturating_sub(fp0)), mb(fp3.saturating_sub(fp0)), mb(fp4.saturating_sub(fp0)), mb(fp5.saturating_sub(fp0)), mb(fp6.saturating_sub(fp0))
    );
}
