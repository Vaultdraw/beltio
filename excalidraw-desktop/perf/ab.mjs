#!/usr/bin/env node
// Base-vs-head A/B perf gate (Chromium mode, interleaved base,head,base,head...). Wrap in the shared build lock:
//   lockf -k .cache/build.lock node excalidraw-desktop/perf/ab.mjs --base main   (run from the main checkout: shared lock)
import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalogue, unitOf } from "./lib/catalogue.mjs";
import { compare } from "./lib/compare.mjs";
import { comparisonTable } from "./lib/report.mjs";
import { parseScenarioList, headScenarioFilter, scenarioNotes } from "./lib/scenarios.mjs";
import { waitQuiet, loadNote, loadSummary, DEFAULT_QUIET_LOAD, DEFAULT_QUIET_WAIT_S } from "./lib/load.mjs";
import {
  interleaveOrder, mergeSide, buildAbResult, ensureBaseWorktree, runOnce, gateFailures, needsReproduction, reproduced, consistentShifts, CONFIRM_PAIRS,
} from "./lib/ab.mjs";

const HELP = `Usage: node excalidraw-desktop/perf/ab.mjs --base <git-ref> [options]

Recommended merge gate: interleaves base, head, base, head... (Chromium mode, one run.mjs --runs 1 each) in one session,
so both sides see the same machine load, then compares head vs base with the catalogue rules (exit 1 on regression).
Two sides only; bisect across a batch only AFTER a confirmed regression.

  --base <ref>        base commit/branch (a detached worktree is created under <head>/.cache/perf/ab/base-<sha>)
  --head <path>       head worktree (default: this worktree)
  --scenarios a,b,..  run only these scenarios on the head (default: the scenarios the base's first run reported, so a scenario
                      added since the base never counts as a regression; the base itself always runs everything it has)
  --all-scenarios     no filter: the head runs every scenario it has (whole-run CPU time and counts then include head-only scenarios)
  --pairs N           base/head pairs (default 1 = quick perf). When anything is flagged, more pairs run
                      automatically up to ${CONFIRM_PAIRS} (--no-confirm skips that)
  Gate: browser.cpu.thread/process and browser.count.* (CPU time, counts) block from any run. Wall-clock
  metrics block only when measured quiet (load < --quiet-load) with >= ${CONFIRM_PAIRS} pairs; otherwise
  they are reported as UNCONFIRMED (the head of engineering's quiet combined check still gates them).
  A wall-clock median that noise widening let through but that moved the same way in every pair is flagged too
  ("same direction in every pair"). These and wall-clock p95 flags block only if they reproduce: when every blocking flag is a wall-clock p95, a second,
  independent A/B (${CONFIRM_PAIRS} fresh pairs, after its own quiet wait) runs, and only the flags it shows again block.
  --no-reproduce      skip that second A/B (the p95 flags then block as measured)
  --low-end           Chromium with CPU throttling x4
  --out <file>        head result JSON (run.mjs format + ab field; default <head>/.cache/perf/results/<ts>-ab-<mode>.json)
  --quiet-load X      quiet gate threshold, 1-min load (default ${DEFAULT_QUIET_LOAD}); runs once, before the first run
  --quiet-wait S      max seconds to wait for it (default ${DEFAULT_QUIET_WAIT_S}; 0 = don't wait)
  --require-quiet     exit 1 if the machine never got quiet

Wrap in the build lock: lockf -k .cache/build.lock node excalidraw-desktop/perf/ab.mjs ...
`;

const { values: o } = parseArgs({
  options: {
    base: { type: "string" }, head: { type: "string" }, pairs: { type: "string" }, "low-end": { type: "boolean" }, out: { type: "string" },
    "quiet-load": { type: "string" }, "quiet-wait": { type: "string" }, "require-quiet": { type: "boolean" }, "no-confirm": { type: "boolean" }, "no-reproduce": { type: "boolean" }, scenarios: { type: "string" }, "all-scenarios": { type: "boolean" }, help: { type: "boolean", short: "h" },
  },
});
if (o.help || !o.base) { console.log(HELP); process.exit(o.help ? 0 : 1); }

const here = path.dirname(fileURLToPath(import.meta.url));
const headWt = path.resolve(o.head ?? path.join(here, "..", ".."));
const runMjs = path.join(here, "run.mjs");
const pairs = Number(o.pairs ?? 1);
const mode = o["low-end"] ? "low-end" : "normal";
const log = (m) => console.error(`[ab] ${m}`);
const t0 = Date.now();

const catalogue = loadCatalogue();
const quietOpts = {
  threshold: o["quiet-load"] !== undefined ? Number(o["quiet-load"]) : DEFAULT_QUIET_LOAD,
  waitS: o["quiet-wait"] !== undefined ? Number(o["quiet-wait"]) : DEFAULT_QUIET_WAIT_S,
  log,
};
const load = await waitQuiet(quietOpts);
if (!load.quiet && o["require-quiet"]) {
  console.error(`[ab] machine not quiet: ${loadSummary(load)}; exiting (--require-quiet)`);
  process.exit(1);
}

const base = ensureBaseWorktree(headWt, o.base);
log(`base ${o.base} = ${base.sha.slice(0, 10)} at ${base.dir}`);
const fixturesDir = path.join(headWt, ".cache", "perf", "fixtures");
const scratch = path.join(headWt, ".cache", "perf", "ab", `run-${Date.now()}`);
mkdirSync(scratch, { recursive: true });

const results = { base: [], head: [] };
const unit = unitOf(catalogue);
// Head scenario allow-list: --scenarios, else (unless --all-scenarios) what the base's first run reported.
let headScenarios = o["all-scenarios"] ? undefined : parseScenarioList(o.scenarios);
let baseScenarios;
const runPairs = async (from, to, into = results, tag = "") => {
  for (const step of interleaveOrder(to).slice(2 * from)) {
    const out = path.join(scratch, `${tag}${step.side}-${step.index}.json`);
    log(`${step.side} run ${step.index + 1}/${to}`);
    const r = await runOnce({
      runMjs, wtRoot: step.side === "base" ? base.dir : headWt, fixturesDir, out, lowEnd: !!o["low-end"],
      // The first run per side builds its own browser bundle; later ones reuse it.
      build: step.index === 0, scenarios: step.side === "head" ? headScenarios : undefined, log,
    });
    into[step.side].push(r);
    if (step.side === "base" && !baseScenarios && r.scenarios?.length) {
      baseScenarios = r.scenarios;
      if (!o["all-scenarios"] && !o.scenarios) {
        headScenarios = headScenarioFilter(baseScenarios);
        log(`head will run only the base's scenarios: ${headScenarios.join(", ")}`);
      }
    }
  }
};
let pairsDone = pairs;
await runPairs(0, pairs);
const failingNow = () => compare({ metrics: mergeSide(results.head, unit).metrics }, { metrics: mergeSide(results.base, unit).metrics }, catalogue).failing;
if (!o["no-confirm"] && pairs < CONFIRM_PAIRS && failingNow().length) {
  log(`flagged after ${pairs} pair(s); confirming with ${CONFIRM_PAIRS} pairs`);
  await runPairs(pairs, CONFIRM_PAIRS);
  pairsDone = CONFIRM_PAIRS;
}
load.end = results.head.at(-1)?.load?.end ?? load.end;

const head = mergeSide(results.head, unit);
const baseSide = mergeSide(results.base, unit);
const lnote = loadNote({ ...load, perRun: [...head.perRunLoad, ...baseSide.perRunLoad] });
const result = buildAbResult({
  template: results.head.at(-1), head, base: baseSide, baseSha: base.sha, pairs: pairsDone, load,
  notes: [
    `A/B interleaved: base ${o.base} (${base.sha.slice(0, 10)}) vs head, ${pairsDone} pair(s)`,
    ...scenarioNotes({ base: baseScenarios, head: results.head.at(-1)?.scenarios, filtered: !!headScenarios }),
    ...(lnote ? [lnote] : []),
  ],
});

const cmp = compare(result, { metrics: baseSide.metrics }, catalogue);
const allLoads = [load.start, load.end, ...head.perRunLoad, ...baseSide.perRunLoad].filter(Number.isFinite);
const quiet = allLoads.every((l) => l < load.threshold);
const failingAll = (c, h, b) => [...c.failing, ...consistentShifts(c.rows, h.metrics, b.metrics)];
let { blocking, unconfirmed } = gateFailures(failingAll(cmp, head, baseSide), { quiet, pairs: pairsDone });

// p95 flags must reproduce (handbook): a second, independent A/B decides which wall-clock p95 flags stand.
let repro;
if (!o["no-reproduce"] && needsReproduction(blocking)) {
  log(`only wall-clock p95 flags block (${blocking.map((r) => r.metric).join(", ")}); reproducing with a fresh ${CONFIRM_PAIRS}-pair A/B`);
  const load2 = await waitQuiet(quietOpts);
  const again = { base: [], head: [] };
  await runPairs(0, CONFIRM_PAIRS, again, "repro-");
  const h2 = mergeSide(again.head, unit);
  const b2 = mergeSide(again.base, unit);
  const failing2 = failingAll(compare({ metrics: h2.metrics }, { metrics: b2.metrics }, catalogue), h2, b2);
  const loads2 = [load2.start, ...h2.perRunLoad, ...b2.perRunLoad].filter(Number.isFinite);
  repro = { ...reproduced(blocking, failing2), pairs: CONFIRM_PAIRS, failing: failing2, loads: loads2, h2, b2 };
  blocking = repro.blocking;
}
console.log(`\nVaultdraw perf A/B - ${mode} - ${pairsDone} pair(s) - head ${String(result.git?.sha).slice(0, 10)} vs base ${base.sha.slice(0, 10)}`);
console.log(comparisonTable(cmp.rows));
console.log(loadSummary(result.load));
for (const n of result.notes) console.log(`note: ${n}`);
const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : "?");
const cvP95 = (r, h, b) => (r.stat === "p95" ? `, per-run p95 CV head ${pct(h.metrics[r.metric]?.cvP95)} base ${pct(b.metrics[r.metric]?.cvP95)}` : "");
const list = (rs, h = head, b = baseSide) =>
  rs.map((r) => `${r.metric}.${r.stat} (${r.status}${r.consistent ? ", same direction in every pair" : ""}${cvP95(r, h, b)})`).join(", ");
if (unconfirmed.length) console.log(`\nUNCONFIRMED (wall-clock, ${quiet ? "" : "under load, "}${pairsDone} pair(s); not blocking): ${list(unconfirmed)}`);
if (repro) {
  const row = (r) => repro.failing.find((x) => x.metric === r.metric && x.stat === r.stat);
  const again = (r) => (row(r) ? ` ${row(r).deltaPct >= 0 ? "+" : ""}${row(r).deltaPct?.toFixed(1)}%` : "");
  console.log(`\np95 reproduction: 2nd A/B, ${repro.pairs} fresh pairs, loads ${repro.loads.map((l) => l.toFixed(2)).join("/")}`);
  if (repro.cleared.length) console.log(`  cleared (not reproduced; not blocking): ${list(repro.cleared)}`);
  if (repro.blocking.length) console.log(`  reproduced: ${repro.blocking.map((r) => `${r.metric}.${r.stat}${again(r)}`).join(", ")}`);
}
if (blocking.length) console.log(`\nFAIL: ${list(blocking)}`);
else console.log(`\nPASS: no regression in CPU time or counts${unconfirmed.length ? "" : " or wall-clock"}`);
if (result.errors.length) console.log(`\nERRORS:\n${result.errors.map((e) => `  - ${e}`).join("\n")}`);
const ids = (rs) => rs.map((r) => `${r.metric}.${r.stat}`);
result.ab.gate = { quiet, blocking: ids(blocking), unconfirmed: ids(unconfirmed) };
if (repro) {
  result.ab.reproduce = {
    pairs: repro.pairs, loads: repro.loads, cleared: ids(repro.cleared), reproduced: ids(repro.blocking), failing: ids(repro.failing),
    head: repro.h2.metrics, base: repro.b2.metrics,
  };
}

const outFile = o.out ? path.resolve(o.out) : path.join(headWt, ".cache", "perf", "results", `${new Date().toISOString().replace(/[:.]/g, "-")}-ab-${mode}.json`);
mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(result, null, 2) + "\n");
console.log(`\nresult: ${outFile}\nelapsed: ${((Date.now() - t0) / 60000).toFixed(1)} min`);
process.exit(blocking.length || result.errors.length ? 1 : 0);
