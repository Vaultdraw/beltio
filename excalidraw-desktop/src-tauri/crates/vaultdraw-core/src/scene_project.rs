//! Reading a drawing's elements without the app: the Rust twin of `projectScene` and
//! `sceneVersion` (`src/sceneOps/project.ts`, `src/control/sceneVersion.ts`).
//!
//! `vaultdraw scene read|get` and the `read_drawing` AI tool use it when the app is closed (or
//! for a drawing that is not open). The app builds the same slim elements and the same version
//! string in TypeScript; both sides read the golden file `tests/fixtures/scene-project-parity.json`
//! (cargo test here, vitest `src/control/sceneProjectParity.test.ts`), so either side drifting
//! fails a test. Regenerate it after an intended change with
//! `UPDATE_PARITY=1 npx vitest run src/control/sceneProjectParity.test.ts`.

use serde_json::{json, Map, Value};
use vaultdraw_protocol::RpcError;

const DEFAULT_LIMIT: u64 = 200;
const MAX_LIMIT: u64 = 2000;
const MAX_GET_IDS: usize = 100;
const KNOWN: [&str; 9] = ["rectangle", "ellipse", "diamond", "text", "arrow", "line", "freedraw", "image", "frame"];

/// cyrb53 over UTF-16 code units (JavaScript's `charCodeAt`), as `sceneVersion.ts`.
fn cyrb53(s: &str) -> u64 {
    let mut h1: i32 = 0xdeadbeef_u32 as i32;
    let mut h2: i32 = 0x41c6ce57;
    for ch in s.encode_utf16() {
        let c = ch as i32;
        h1 = (h1 ^ c).wrapping_mul(2654435761_u32 as i32);
        h2 = (h2 ^ c).wrapping_mul(1597334677);
    }
    h1 = (h1 ^ ((h1 as u32) >> 16) as i32).wrapping_mul(2246822507_u32 as i32);
    h1 ^= (h2 ^ ((h2 as u32) >> 13) as i32).wrapping_mul(3266489909_u32 as i32);
    h2 = (h2 ^ ((h2 as u32) >> 16) as i32).wrapping_mul(2246822507_u32 as i32);
    h2 ^= (h1 ^ ((h1 as u32) >> 13) as i32).wrapping_mul(3266489909_u32 as i32);
    4294967296_u64 * (2097151 & (h2 as u32 as u64)) + (h1 as u32 as u64)
}

fn base36(mut n: u64) -> String {
    if n == 0 {
        return "0".into();
    }
    let mut out = Vec::new();
    while n > 0 {
        out.push(b"0123456789abcdefghijklmnopqrstuvwxyz"[(n % 36) as usize]);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

fn deleted(el: &Value) -> bool {
    el.get("isDeleted").and_then(Value::as_bool).unwrap_or(false)
}

/// `s` + base 36 of the hash of `id \0 version \1` over the live elements, in order.
pub fn scene_version(elements: &[Value]) -> String {
    let mut s = String::new();
    for el in elements.iter().filter(|e| !deleted(e)) {
        let id = el.get("id").and_then(Value::as_str).unwrap_or("");
        let version = el.get("version").map(|v| v.to_string()).unwrap_or_else(|| "1".into());
        s.push_str(&format!("{id}\u{0}{version}\u{1}"));
    }
    format!("s{}", base36(cyrb53(&s)))
}

fn num(el: &Value, key: &str) -> Value {
    el.get(key).filter(|v| v.is_number()).cloned().unwrap_or_else(|| json!(0))
}

/// The slim element: id, type (unknown ones are `other`), box, angle, text, colours.
pub fn project(el: &Value) -> Value {
    let ty = el.get("type").and_then(Value::as_str).unwrap_or("other");
    let mut out = Map::new();
    out.insert("id".into(), el.get("id").cloned().unwrap_or(Value::Null));
    out.insert("type".into(), json!(if KNOWN.contains(&ty) { ty } else { "other" }));
    for k in ["x", "y", "width", "height", "angle"] {
        out.insert(k.into(), num(el, k));
    }
    if ty == "text" {
        out.insert("text".into(), el.get("text").cloned().unwrap_or_else(|| json!("")));
    }
    for k in ["strokeColor", "backgroundColor"] {
        if let Some(v) = el.get(k).filter(|v| !v.is_null()) {
            out.insert(k.into(), v.clone());
        }
    }
    Value::Object(out)
}

fn live_elements(scene: &Value) -> Vec<Value> {
    scene.get("elements").and_then(Value::as_array).map(|a| a.to_vec()).unwrap_or_default()
}

fn strings(params: &Value, key: &str, max: usize) -> Result<Option<Vec<String>>, RpcError> {
    match params.get(key).filter(|v| !v.is_null()) {
        None => Ok(None),
        Some(Value::Array(a)) if a.len() <= max && a.iter().all(|s| s.as_str().is_some_and(|s| !s.is_empty())) => {
            Ok(Some(a.iter().filter_map(|s| s.as_str().map(String::from)).collect()))
        }
        Some(_) => Err(RpcError::invalid_params(format!("{key} must be an array of strings (at most {max})"))),
    }
}

fn int(params: &Value, key: &str, min: u64, max: u64, fallback: u64) -> Result<u64, RpcError> {
    match params.get(key).filter(|v| !v.is_null()) {
        None => Ok(fallback),
        Some(v) => v.as_u64().filter(|n| (min..=max).contains(n)).ok_or_else(|| RpcError::invalid_params(format!("{key} must be an integer from {min} to {max}"))),
    }
}

/// `scene.read` for a drawing on disk: not live, no viewport, no selection.
pub fn read(path: &str, scene: &Value, read_only: bool, params: &Value) -> Result<Value, RpcError> {
    if params.get("scope").and_then(Value::as_str).is_some_and(|s| s != "all") {
        return Err(RpcError::invalid_params("scope viewport and selection need the drawing on screen; start Vaultdraw and open it"));
    }
    let types = strings(params, "types", usize::MAX)?;
    let ids = strings(params, "ids", usize::MAX)?;
    let limit = int(params, "limit", 1, MAX_LIMIT, DEFAULT_LIMIT)? as usize;
    let offset = int(params, "offset", 0, u64::MAX, 0)? as usize;
    let all = live_elements(scene);
    let matches: Vec<Value> = all
        .iter()
        .filter(|e| !deleted(e))
        .map(project)
        .filter(|e| types.as_ref().is_none_or(|t| e["type"].as_str().is_some_and(|ty| t.iter().any(|x| x == ty))))
        .filter(|e| ids.as_ref().is_none_or(|i| e["id"].as_str().is_some_and(|id| i.iter().any(|x| x == id))))
        .collect();
    let mut counts = Map::new();
    for e in &matches {
        let ty = e["type"].as_str().unwrap_or("other").to_string();
        let n = counts.get(&ty).and_then(Value::as_u64).unwrap_or(0) + 1;
        counts.insert(ty, json!(n));
    }
    let page: Vec<Value> = matches.iter().skip(offset).take(limit).cloned().collect();
    Ok(json!({
        "path": path,
        "live": false,
        "readOnly": read_only,
        "version": scene_version(&all),
        "total": matches.len(),
        "returned": page.len(),
        "truncated": offset + page.len() < matches.len(),
        "counts": counts,
        "elements": page,
    }))
}

/// `scene.get` for a drawing on disk (slim elements by id).
pub fn get(path: &str, scene: &Value, params: &Value) -> Result<Value, RpcError> {
    let ids = strings(params, "ids", MAX_GET_IDS)?.filter(|i| !i.is_empty()).ok_or_else(|| RpcError::invalid_params("ids must be a non-empty array of strings (at most 100)"))?;
    let all = live_elements(scene);
    let mut found = Vec::new();
    let mut missing = Vec::new();
    for id in &ids {
        match all.iter().find(|e| !deleted(e) && e.get("id").and_then(Value::as_str) == Some(id)) {
            Some(e) => found.push(project(e)),
            None => missing.push(id.clone()),
        }
    }
    Ok(json!({"path": path, "version": scene_version(&all), "elements": found, "missing": missing}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_typescript_twin_on_the_golden_file() {
        let golden: Value = serde_json::from_str(include_str!("../tests/fixtures/scene-project-parity.json")).unwrap();
        for case in golden["cases"].as_array().unwrap() {
            let name = case["name"].as_str().unwrap();
            let els = case["elements"].as_array().unwrap();
            assert_eq!(scene_version(els), case["version"].as_str().unwrap(), "{name}: version");
            let live: Vec<Value> = els.iter().filter(|e| !deleted(e)).map(project).collect();
            assert_eq!(Value::Array(live), case["projected"], "{name}: projection");
        }
    }

    #[test]
    fn paging_filters_and_scope() {
        let els: Vec<Value> = (0..5).map(|i| json!({"id": format!("e{i}"), "type": if i % 2 == 0 {"rectangle"} else {"text"}, "version": 1, "text": "hi"})).collect();
        let scene = json!({"elements": els});
        let r = read("a.excalidraw", &scene, false, &json!({"types": ["rectangle"], "limit": 2})).unwrap();
        assert_eq!((r["total"].as_u64(), r["returned"].as_u64(), r["truncated"].as_bool()), (Some(3), Some(2), Some(true)));
        assert_eq!(r["counts"], json!({"rectangle": 3}));
        assert!(read("a", &scene, false, &json!({"scope": "viewport"})).is_err());
        assert!(read("a", &scene, false, &json!({"limit": 0})).is_err());
        let g = get("a", &scene, &json!({"ids": ["e1", "zz"]})).unwrap();
        assert_eq!(g["elements"].as_array().unwrap().len(), 1);
        assert_eq!(g["missing"], json!(["zz"]));
        assert!(get("a", &scene, &json!({"ids": []})).is_err());
    }
}
