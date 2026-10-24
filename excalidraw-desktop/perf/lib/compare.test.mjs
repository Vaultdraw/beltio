import test from "node:test";
import assert from "node:assert/strict";
import { compare, pickBaseline } from "./compare.mjs";
import { loadCatalogue, specFor } from "./catalogue.mjs";
import { resultTable } from "./report.mjs";

const cat = loadCatalogue();
const m = (o) => ({ metrics: o });
const mk = (median, p95 = median, extra = {}) => ({ unit: "ms", median, p95, max: p95, cv: 0, noisy: false, ...extra });
const row = (r, metric, stat) => r.rows.find((x) => x.metric === metric && x.stat === stat);

test("5% boundary: exactly 5% passes, above fails", () => {
  const base = m({ "save.medium": mk(100) });
  assert.equal(row(compare(m({ "save.medium": mk(105) }), base, cat), "save.medium", "median").status, "ok");
  const r = compare(m({ "save.medium": mk(106) }), base, cat);
  assert.equal(row(r, "save.medium", "median").status, "regressed");
  assert.equal(r.exitCode, 1);
});

test("absolute slack: +0.8 ms on 10 ms (8%) is ignored, +1.5 ms is not", () => {
  const base = m({ "save.medium": mk(10) });
  assert.equal(row(compare(m({ "save.medium": mk(10.8) }), base, cat), "save.medium", "median").status, "ok");
  assert.equal(row(compare(m({ "save.medium": mk(11.5) }), base, cat), "save.medium", "median").status, "regressed");
});

test("noisy widening: +20% passes with CV 15%, flagged noisy-ok", () => {
  const base = m({ "save.medium": mk(100, 100, { cv: 0.15, noisy: true }) });
  const r = compare(m({ "save.medium": mk(120) }), base, cat);
  const x = row(r, "save.medium", "median");
  assert.equal(x.status, "noisy-ok");
  assert.ok(x.threshold >= 30 - 1e-9);
  assert.equal(r.exitCode, 0);
  assert.equal(row(compare(m({ "save.medium": mk(140) }), base, cat), "save.medium", "median").status, "regressed");
});

test("frame metrics gate p95 only; longFrames median with zero slack", () => {
  const base = m({ "pan.frame": mk(16.7, 20), "typing.longFrames": { unit: "count", median: 0, p95: 0, max: 0, cv: 0, noisy: false } });
  const r = compare(m({ "pan.frame": mk(30, 20.5), "typing.longFrames": { unit: "count", median: 1, p95: 1, max: 1, cv: 0, noisy: false } }), base, cat);
  assert.equal(r.rows.filter((x) => x.metric === "pan.frame").length, 1);
  assert.equal(row(r, "pan.frame", "p95").status, "ok");
  assert.equal(row(r, "typing.longFrames", "median").status, "regressed");
});

test("budget breach fails when baseline met it; pre-existing is a warning", () => {
  const good = m({ "search.keystroke": mk(10, 40) });
  const bad = m({ "search.keystroke": mk(10, 60) });
  const fail = compare(bad, good, cat);
  assert.equal(fail.exitCode, 1);
  assert.ok(fail.rows.some((x) => x.status === "budget"));
  const pre = compare(m({ "search.keystroke": mk(10, 60) }), m({ "search.keystroke": mk(10, 59) }), cat);
  assert.ok(pre.rows.some((x) => x.status === "budget-preexisting"));
  assert.equal(pre.exitCode, 0);
  // no baseline value: new + breach fails
  assert.equal(compare(bad, m({}), cat).exitCode, 1);
});

test("open.large has no budget; browser.<id> inherits spec; missing/new", () => {
  const r = compare(m({ "open.large": mk(5000), "browser.open.small": mk(400) }), m({ "open.large": mk(5000), "save.large": mk(1) }), cat);
  assert.equal(r.exitCode, 1); // browser.open.small budget breach (no baseline)
  assert.ok(r.rows.some((x) => x.metric === "browser.open.small" && x.status === "new"));
  assert.ok(r.rows.some((x) => x.metric === "save.large" && x.status === "missing"));
  assert.ok(!r.rows.some((x) => x.metric === "open.large" && x.status !== "ok"));
});

test("combined baseline picks the matching mode; warns on machine mismatch", () => {
  const normal = { mode: "normal", metrics: {} };
  const low = { mode: "low-end", metrics: {} };
  const file = { machine: { brand: "M1", memBytes: 1 }, modes: { normal, "low-end": low } };
  assert.equal(pickBaseline(file, "low-end", { brand: "M1", memBytes: 1 }).baseline, low);
  const p = pickBaseline(file, "normal", { brand: "M4", memBytes: 2 });
  assert.equal(p.baseline, normal);
  assert.equal(p.warnings.length, 1);
  assert.equal(pickBaseline({ modes: { normal } }, "low-end").baseline, null);
  assert.equal(pickBaseline(normal, "low-end").warnings.length, 1);
});

test("higher-is-better metrics: a drop regresses, a rise improves, min budgets", () => {
  const fps = (median, min = median) => ({ unit: "fps", median, p95: median, min, max: median, cv: 0, noisy: false });
  const base = m({ "zoom.fps": fps(118) });
  assert.equal(row(compare(m({ "zoom.fps": fps(100, 100) }), base, cat), "zoom.fps", "median").status, "regressed");
  assert.equal(row(compare(m({ "zoom.fps": fps(119) }), base, cat), "zoom.fps", "median").status, "ok");
  const low = m({ "zoom.fps": fps(60, 58) });
  const up = compare(m({ "zoom.fps": fps(118, 116) }), low, cat);
  assert.equal(row(up, "zoom.fps", "median").status, "improved");
  assert.equal(up.exitCode, 0);
  const breach = compare(m({ "zoom.fps": fps(118, 100) }), base, cat);
  assert.ok(breach.rows.some((r) => r.metric === "zoom.fps" && r.status === "budget" && r.note.includes(">= 110")));
  assert.equal(breach.exitCode, 1);
});

test("metrics absent from the baseline are 'new'; warn-only budgets and report-only metrics never fail", () => {
  const cur = m({ "settings.open": mk(150), "palette.openFiles": mk(40), "startup.jsStart": mk(90) });
  const r = compare(cur, m({ "save.large": mk(1) }), cat);
  assert.equal(r.exitCode, 0);
  assert.ok(r.rows.some((x) => x.metric === "palette.openFiles" && x.status === "new"));
  assert.ok(r.rows.some((x) => x.metric === "settings.open" && x.status === "budget-warn"));
  assert.ok(!r.rows.some((x) => x.metric === "startup.jsStart"));
  // with a baseline that met the budget it is still only a warning
  const withBase = compare(cur, m({ "settings.open": mk(50) }), cat);
  assert.equal(withBase.exitCode, 1); // 50 -> 150 is a real regression
  assert.ok(withBase.rows.some((x) => x.metric === "settings.open" && x.status === "budget-warn"));
});

test("warn budget: a breach is reported as budget-warn and never fails", () => {
  const r = compare(m({ "memory.leak.growthMB": mk(80, 80, { unit: "MB" }) }), m({}), cat);
  const x = r.rows.find((y) => y.status === "budget-warn");
  assert.equal(x.metric, "memory.leak.growthMB");
  assert.match(x.note, /warning only/);
  assert.equal(r.exitCode, 0);
  const ok = compare(m({ "memory.leak.growthMB": mk(10, 10, { unit: "MB" }) }), m({}), cat);
  assert.equal(ok.rows.some((y) => y.status === "budget-warn"), false);
});

test("D9: packaged low-end open.* is report-only, open.*.ready and browser.open.* gate; normal mode gates the full open", () => {
  const base = { mode: "low-end", metrics: { "open.small": mk(240), "open.small.ready": mk(60), "browser.open.small": mk(120) } };
  const slowFrames = { mode: "low-end", metrics: { "open.small": mk(400), "open.small.ready": mk(61), "browser.open.small": mk(121) } };
  const a = compare(slowFrames, base, cat);
  assert.equal(a.exitCode, 0);
  assert.ok(!a.rows.some((x) => x.metric === "open.small"));
  const slowReady = { mode: "low-end", metrics: { "open.small": mk(240), "open.small.ready": mk(80), "browser.open.small": mk(120) } };
  assert.equal(row(compare(slowReady, base, cat), "open.small.ready", "median").status, "regressed");
  const slowChromium = { mode: "low-end", metrics: { "open.small": mk(240), "open.small.ready": mk(60), "browser.open.small": mk(150) } };
  assert.equal(row(compare(slowChromium, base, cat), "browser.open.small", "median").status, "regressed");
  // the budget (300 ms) on .ready fails when the baseline met it
  const over = { mode: "low-end", metrics: { "open.medium.ready": mk(310, 320) } };
  const ok = { mode: "low-end", metrics: { "open.medium.ready": mk(250, 260) } };
  assert.equal(compare(over, ok, cat).exitCode, 1);
  // normal mode keeps gating the full open
  const n0 = { mode: "normal", metrics: { "open.small": mk(40) } };
  const n1 = { mode: "normal", metrics: { "open.small": mk(60) } };
  assert.equal(row(compare(n1, n0, cat), "open.small", "median").status, "regressed");
  // an explicit mode argument wins (ab.mjs passes {metrics} only)
  assert.equal(compare({ metrics: slowFrames.metrics }, base, cat, "low-end").exitCode, 0);
  // the result table shows no budget where the gate has none (it agrees with compare)
  assert.deepEqual(specFor(cat, "open.small", "low-end").gate, []);
  const line = (r, id) => resultTable(r, cat).split("\n").find((l) => l.trim().startsWith(id + " "));
  assert.doesNotMatch(line({ mode: "low-end", metrics: { "open.small": mk(400) } }, "open.small"), /< 300/);
  assert.match(line({ mode: "low-end", metrics: { "open.small.ready": mk(60) } }, "open.small.ready"), /< 300/);
});
