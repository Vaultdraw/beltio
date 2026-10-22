//! Deterministic generator of realistic drawings (mixed text, bound labels, tags, CJK, image blobs)
//! shared by the core and app benchmarks. Test support only.

use std::{fs, path::Path, time::Duration};

pub struct Rng(pub u64);

impl Rng {
    pub fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    pub fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    pub fn range(&mut self, lo: usize, hi: usize) -> usize {
        lo + self.below(hi - lo + 1)
    }
}

pub const WORDS: &[&str] = &[
    "service", "database", "client", "server", "gateway", "queue", "cache", "worker", "auth", "token", "user", "order", "payment", "invoice", "report", "dashboard", "graph", "node", "edge", "tree", "heap", "stack", "array", "sort", "search", "index", "query", "schema", "table", "column", "migration", "deploy", "pipeline", "build", "test", "release", "rollback", "monitor", "alert", "metric", "latency", "throughput", "retry", "timeout", "backoff", "circuit", "breaker", "sidecar", "proxy", "ingress", "egress", "cluster", "pod", "container", "volume", "secret", "config", "feature", "flag", "experiment", "metrics", "design", "review", "sprint", "backlog", "epic", "story", "roadmap", "milestone", "risk", "owner", "team", "meeting", "agenda", "notes", "todo", "idea", "question", "answer", "decision", "option", "pros", "cons", "cost", "budget", "estimate", "dijkstra", "shortest", "path", "kruskal", "prim", "bellman", "ford", "topological", "dynamic", "programming", "recursion", "memoization", "binary", "hash", "collision", "bucket", "flow", "state", "machine", "event", "stream", "batch", "window", "join", "shuffle", "partition", "replica", "leader", "follower", "consensus", "raft", "paxos", "quorum", "cafe", "resume", "naive", "über", "straße", "école", "niño",
];

pub const CJK: &[&str] = &["数据库设计", "服务认证流程", "用户登录", "支付网关", "消息队列", "缓存策略", "系统架构图", "データベース", "カフェメニュー", "ひらがな", "한국어 문서", "검색 기능"];

pub const TAGS: &[&str] = &["dsa", "dsa/graphs", "dsa/trees", "dsa/dp", "interview", "interview/prep", "Interview/Behavioural", "todo", "idea", "systems/design", "systems/networking", "work/q3", "work/q4", "review", "diagram", "meeting", "research", "café", "数据库", "archive"];

pub const FOLDERS: &[&str] = &["Work", "Personal", "DSA", "Systems", "Ideas", "Archive", "Meetings", "Design", "Research", "Learning"];

pub fn sentence(r: &mut Rng, n: usize) -> String {
    (0..n).map(|_| WORDS[r.below(WORDS.len())]).collect::<Vec<_>>().join(" ")
}

pub fn make_drawing(r: &mut Rng, blob: Option<&str>, d: usize) -> String {
    let n_text = r.range(5, 60);
    let mut els: Vec<String> = Vec::new();
    for i in 0..n_text {
        let words = r.range(1, 8);
        let mut t = sentence(r, words);
        if r.below(40) == 0 {
            t = CJK[r.below(CJK.len())].to_string();
        }
        if r.below(25) == 0 {
            t = sentence(r, 60); // a paragraph
        }
        if r.below(3) == 0 {
            // bound label: container + wrapped text vs originalText
            els.push(format!(r#"{{"id":"box{i}","type":"rectangle","x":10.5,"y":20.25,"width":120,"height":60,"isDeleted":false,"boundElements":[{{"id":"t{i}","type":"text"}}]}}"#));
            let wrapped = t.replace(' ', "\\n");
            els.push(format!(r#"{{"id":"t{i}","type":"text","containerId":"box{i}","text":"{wrapped}","originalText":"{t}","x":12,"y":22,"width":100,"height":20,"isDeleted":false}}"#));
        } else {
            els.push(format!(r#"{{"id":"t{i}","type":"text","text":"{t}","originalText":"{t}","x":1.5,"y":2.5,"width":100,"height":20,"isDeleted":{}}}"#, r.below(15) == 0));
        }
        if r.below(4) == 0 {
            els.push(format!(r#"{{"id":"a{i}","type":"arrow","x":0,"y":0,"points":[[0,0],[100,50]],"isDeleted":false}}"#));
        }
    }
    for f in 0..r.below(4) {
        els.push(format!(r#"{{"id":"frame{f}","type":"frame","name":"{}","x":0,"y":0,"width":500,"height":400,"isDeleted":false}}"#, sentence(r, 2)));
    }
    // Tags use their own generator so the text corpus (and the F1 baselines) stay unchanged.
    let mut tr = Rng(0xD1B54A32D192ED03 ^ (d as u64 + 1).wrapping_mul(0x9E3779B97F4A7C15));
    if tr.below(10) < 6 {
        let tags: Vec<String> = (0..tr.range(1, 3)).map(|_| format!("#{}", TAGS[tr.below(TAGS.len())])).collect();
        els.push(format!(r#"{{"id":"tags","type":"text","text":"{0}","originalText":"{0}","isDeleted":false}}"#, tags.join(" ")));
    }
    let files = match blob {
        Some(b) => format!(r#"{{"file1":{{"mimeType":"image/png","id":"file1","dataURL":"data:image/png;base64,{b}","created":1}}}}"#),
        None => "{}".into(),
    };
    format!(r##"{{"type":"excalidraw","version":2,"source":"bench","elements":[{}],"appState":{{"viewBackgroundColor":"#ffffff"}},"files":{files}}}"##, els.join(","))
}

/// Writes `count` realistic drawings under `root` (10% carry a 1-2 MB image blob), mtimes 6 h in the past.
/// Returns (total bytes, drawings with a blob).
pub fn generate(root: &Path, count: usize) -> (usize, usize) {
    let mut r = Rng(0x9E3779B97F4A7C15);
    let blob_small = "iVBORw0KGgo".repeat(1_100_000 / 11); // ~1.1 MB
    let blob_big = "iVBORw0KGgo".repeat(2_000_000 / 11); // ~2 MB
    let (mut bytes, mut with_blob) = (0usize, 0usize);
    let past = std::time::SystemTime::now() - Duration::from_secs(6 * 3600);
    for d in 0..count {
        let blob = if d % 10 == 3 {
            with_blob += 1;
            Some(if d % 20 == 3 { blob_big.as_str() } else { blob_small.as_str() })
        } else {
            None
        };
        let json = make_drawing(&mut r, blob, d);
        bytes += json.len();
        let top = FOLDERS[r.below(FOLDERS.len())];
        let sub = r.below(20);
        let title = if d % 40 == 0 { CJK[r.below(CJK.len())].to_string() } else { sentence(&mut r, 2) };
        let rel = format!("{top}/sub{sub}/{title} {d}.excalidraw");
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, json).unwrap();
        fs::OpenOptions::new().write(true).open(&p).unwrap().set_modified(past).unwrap();
    }
    (bytes, with_blob)
}
