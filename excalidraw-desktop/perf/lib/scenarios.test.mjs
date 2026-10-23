import test from "node:test";
import assert from "node:assert/strict";
import { parseScenarioList, scenarioNames, headScenarioFilter, scenarioNotes } from "./scenarios.mjs";
import { pageUrl } from "./browser.mjs";
import { mergeSide, gateFailures } from "./ab.mjs";
import { compare } from "./compare.mjs";
import { loadCatalogue, unitOf } from "./catalogue.mjs";

test("parseScenarioList trims and drops empties", () => {
  assert.deepEqual(parseScenarioList(" a, b,,c "), ["a", "b", "c"]);
  assert.equal(parseScenarioList(""), undefined);
  assert.equal(parseScenarioList(undefined), undefined);
});

test("scenarioNames reads scenarioMs.* keys in order and ignores the rest", () => {
  assert.deepEqual(scenarioNames({ engine: "chromium", "scenarioMs.vault-open": 5, "scenarioMs.open": 9, refreshRate: 1 }), ["vault-open", "open"]);
  assert.deepEqual(scenarioNames(undefined), []);
});

test("headScenarioFilter: base list becomes the allow-list; no base list means no filter", () => {
  assert.deepEqual(headScenarioFilter(["a", "b"]), ["a", "b"]);
  assert.equal(headScenarioFilter([]), undefined);
  assert.equal(headScenarioFilter(undefined), undefined);
});

test("scenarioNotes names head-only and base-only scenarios", () => {
  assert.deepEqual(scenarioNotes({ base: ["a"], head: ["a"], filtered: false }), []);
  const n = scenarioNotes({ base: ["a", "old"], head: ["a", "switch"], filtered: false });
  assert.equal(n.length, 2);
  assert.match(n[0], /only in head.*switch/);
  assert.match(n[1], /only in base.*old/);
  assert.match(scenarioNotes({ base: ["a"], head: ["a"], filtered: true })[0], /like-for-like/);
});

test("pageUrl keeps the leak URLs and adds the scenario filter", () => {
  assert.equal(pageUrl(1), "http://127.0.0.1:1/");
  assert.equal(pageUrl(1, { leak: true }), "http://127.0.0.1:1/?leak=1");
  assert.equal(pageUrl(1, { leak: true, leakOnly: true }), "http://127.0.0.1:1/?leak=1&only=1");
  assert.equal(pageUrl(1, { scenarios: ["vault-open", "open"] }), "http://127.0.0.1:1/?scenarios=vault-open%2Copen");
  assert.equal(pageUrl(1, { skipScenarios: ["switch"] }), "http://127.0.0.1:1/?skip=switch");
});

// The 2026-10-24 false alarm: the head ran switch/settings/palette, which the old base lacks, so whole-run CPU time and counts rose.
const runWith = (scenarios) => {
  const per = { open: { layout: 100, thread: 400 }, switch: { layout: 30, thread: 150 }, settings: { layout: 20, thread: 100 }, palette: { layout: 25, thread: 120 } };
  const sum = (k) => scenarios.reduce((a, s) => a + per[s][k], 0);
  return { raw: { browser: [{ "browser.count.layout": [sum("layout")], "browser.cpu.thread": [sum("thread")] }] }, load: { start: 1 }, errors: [] };
};
const cat = loadCatalogue();
const verdict = (head, base) => {
  const h = mergeSide([head], unitOf(cat));
  const b = mergeSide([base], unitOf(cat));
  const c = compare({ metrics: h.metrics }, { metrics: b.metrics }, cat);
  return gateFailures(c.failing, { quiet: true, pairs: 1 }).blocking.map((r) => r.metric);
};

test("a scenario added since the base is a false regression when the head runs it, not when filtered", () => {
  const base = runWith(["open"]);
  assert.deepEqual(verdict(runWith(["open", "switch", "settings", "palette"]), base).sort(), ["browser.count.layout", "browser.cpu.thread"]);
  assert.deepEqual(verdict(runWith(["open"]), base), []);
});

test("scenarioNotes: a hand-picked head filter is flagged as not like-for-like", () => {
  const n = scenarioNotes({ base: ["a", "b"], head: ["a"], filtered: true, manual: true, headFilter: ["a"] });
  assert.match(n[0], /NOT like-for-like.*only a/);
});
