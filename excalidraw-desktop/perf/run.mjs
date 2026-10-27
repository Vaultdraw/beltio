#!/usr/bin/env node
// Perf harness CLI. Callers wrap the whole command in the shared build lock:
//   lockf -k .cache/build.lock node excalidraw-desktop/perf/run.mjs ...   (run from the main checkout: shared lock)
// This runner never takes the lock itself (nested lockf would deadlock).
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadCatalogue, specFor, unitOf } from "./lib/catalogue.mjs";
import { aggregate } from "./lib/stats.mjs";
import { compare, pickBaseline } from "./lib/compare.mjs";
import { buildPerfApp, reuseBuiltApp, runAppOnce, gitInfo, perfCacheDir, isScreenLocked, isRafStall } from "./lib/app.mjs";
import { waitQuiet, loadAvg1, loadNote, loadSummary, DEFAULT_QUIET_LOAD, DEFAULT_QUIET_WAIT_S } from "./lib/load.mjs";
import { parseScenarioList, scenarioNames } from "./lib/scenarios.mjs";
import { machineInfo, resultTable, comparisonTable, updateBaseline } from "./lib/report.mjs";
import { isLinux } from "./lib/linux.mjs";

const HELP = `Usage: node excalidraw-desktop/perf/run.mjs [options]

  --low-end              packaged app under taskpolicy -c background (+ WebKit helpers clamped), memory_pressure -S on
                         Note: background QoS also coalesces timers (a 5 ms sleep takes ~100 ms), so frame pacing drops to
                         ~9 Hz (frame.rafInterval ~108 ms) and every "until next frame" metric carries that floor.
  PERF_LOWEND_ROLES=r,.. (env) low-end: clamp only these processes (app, webContent, gpu, network); default all
  PERF_LOWEND_APP_QOS=q  (env) low-end: taskpolicy clamp for the app process (default background; e.g. utility)
  Default (between milestones): Chromium mode only (headless, no windows), 2 runs, no warmup, no extra noise runs.
  --app                  also measure the packaged app (opens app windows; 2 runs)
  --milestone            full gate: packaged app + Chromium, 4 runs + 1 warmup, up to 2 extra runs when noisy
  --runs N               measured runs (default 2; 4 with --milestone), after --warmup (default 0; 1 with --milestone)
  --warmup N             warmup runs to discard
  --compare <file>       gate against a baseline (single result or combined {modes:{normal,"low-end"}}); exit 1 on regression
  --out <file>           result JSON (default <wt>/.cache/perf/results/<timestamp>-<mode>.json)
  --update-baseline <f>  merge this result into modes[mode] of combined file <f> (+ sibling .md)
  --no-build             reuse <wt>/.cache/perf/app/Vaultdraw.app
  --skip-browser         skip Chromium mode (lib/browser.mjs; skipped automatically if absent)
  --skip-app             skip the packaged-app mode
  --memory-pressure      run 'memory_pressure -S' (simulated; needs root, else noted and ignored) in normal mode too
  --keep-runs            keep per-run vault clones under .cache/perf/runs
  PERF_MEM_TIMELINE=1    (env) note per-process footprint at every phase boundary
  VAULTDRAW_PERF_LAYER_DIR=<d> (env, memory diagnosis) the app writes <d>/<pid>-<mark>.txt at every perf mark: WebKit layer
                         tree, DOM elements likely to be composited, big canvases and their resizes, and every rise of a
                         process's lifetime footprint peak (sampled every 50 ms) with the perf step that was running
  --quiet-load X         quiet gate: wait for 1-min load average < X before measuring (default ${DEFAULT_QUIET_LOAD})
  --quiet-wait S         wait up to S seconds for it (default ${DEFAULT_QUIET_WAIT_S}; 0 = don't wait), then measure anyway
  --require-quiet        exit 1 instead of measuring when the machine never got quiet
  PERF_WT_ROOT           (env) measure another worktree's app/harness with this runner's code (ab.mjs uses it for the base side)
  PERF_FIXTURES_DIR      (env) fixture vault cache dir (default <wt>/.cache/perf/fixtures); ab.mjs shares one
  --leak                 (or PERF_LEAK=1) memory leak scenario after the normal phases (+ ~60 s per run): open 50 drawings,
                         switch vault and back, idle; footprint per process at each checkpoint -> memory.leak.* metrics.
                         Also runs in Chromium mode (JS heap after forced GC). Opt-in: default run time is unchanged.
  --leak-only            (or PERF_LEAK_ONLY=1) leak scenario right after vault-open, skipping the stress phases: a clean baseline
                         (after the stress phases WebKit still holds ~300 MB that it releases only later, which hides growth)
  --ablate               (or PERF_ABLATE=1) memory ablation probe (implies --typical, sets PERF_MEM_TIMELINE=1): after the typical open,
                         hides one UI part at a time (canvases, navigator, chrome, header, bitmap cache, ...), waits 5 s and samples
                         per-process footprint at each phase:abl-* mark (memory timeline + abl.* in-app counters). ~3 min per run.
  --typical              (or PERF_TYPICAL=1) typical-vault mode, packaged app only (implies --app): 50 drawings in a few
                         folders + one 300-element drawing with 2 images; cold start, open, save, pan, idle footprint per
                         process (memory.typical.*) for comparison with other note apps. Replaces the stress scenarios.
  --foreground           (or PERF_FOREGROUND=1) launch the perf app as a normal foreground app (no accessory/hidden-rendering hardening); default unchanged
  --everyday             (or PERF_EVERYDAY=1) the owner's typical use (implies --typical): the typical vault plus 3 note drawings
                         of 12 shapes and 100 lines of text each; opens all 3 in tabs, switches back, types a note, saves, pans,
                         then the idle footprint. Same memory.* metrics as --typical.
  PERF_TYPICAL_GAP_MS=N  (env) typical mode: ms between the warm drawing opens (default 300), e.g. 2000 for a human pace
  PERF_CONFIG_TOML=<f>   (env) config.toml for the perf app's temp config dir (e.g. [interface] thumbnails = false)
  --scenarios a,b,..     Chromium mode: run only these scenarios (vault-open always runs). Names as in the result's "scenarios"
                         field: vault-open, tree-expand, search, open, switch, settings, palette, save, pan-zoom, typing
  --skip-scenarios a,..  Chromium mode: run all scenarios except these. ab.mjs sets --scenarios itself (see its --help)
  --quick                1 run, no warmup, no extra noise runs (harness smoke test)

Linux (scripts/linux-perf.sh wraps all of this): --app --no-build --skip-browser measures the plain release binary
  (PERF_APP_BIN, else <CARGO_TARGET_DIR or src-tauri/target>/release/excalidraw-vault, built with --features smoke-test)
  on the DISPLAY in the environment (Xvfb). --low-end = systemd-run --user --scope CPUQuota=25% MemoryHigh=1G
  (PERF_LOWEND_CPU_QUOTA, PERF_LOWEND_MEMORY_HIGH; nice -n 19 + taskset when systemd-run is unavailable); no
  memory_pressure, caffeinate or screen-lock check. PERF_APP_TIMEOUT_MS overrides the per-run timeout on slow VMs.
  Baseline: personal/perf/linux/baseline.json (numbers are only comparable within the same machine).

Recommended merge gate: node excalidraw-desktop/perf/ab.mjs --base <ref> (interleaved base/head A/B in one session; bisect only after a
confirmed regression). Wall-clock metrics swing with machine load; browser.cpu.* / browser.count.* (CDP CPU time, event counts) are load-insensitive.

The runner does not take the build lock. Wrap the whole command:
  lockf -k .cache/build.lock node excalidraw-desktop/perf/run.mjs [options]
`;

const { values: o } = parseArgs({
  options: {
    "low-end": { type: "boolean" }, runs: { type: "string" }, warmup: { type: "string" }, compare: { type: "string" },
    out: { type: "string" }, "update-baseline": { type: "string" }, "no-build": { type: "boolean" },
    "skip-browser": { type: "boolean" }, "skip-app": { type: "boolean" }, "memory-pressure": { type: "boolean" },
    "keep-runs": { type: "boolean" }, "quiet-load": { type: "string" }, "quiet-wait": { type: "string" }, "require-quiet": { type: "boolean" }, leak: { type: "boolean" }, "leak-only": { type: "boolean" }, scenarios: { type: "string" }, "skip-scenarios": { type: "string" }, typical: { type: "boolean" }, everyday: { type: "boolean" }, ablate: { type: "boolean" }, foreground: { type: "boolean" }, quick: { type: "boolean" }, app: { type: "boolean" }, milestone: { type: "boolean" }, help: { type: "boolean", short: "h" },
  },
});
if (o.help) { console.log(HELP); process.exit(0); }

const here = path.dirname(fileURLToPath(import.meta.url));
const wtRoot = process.env.PERF_WT_ROOT ? path.resolve(process.env.PERF_WT_ROOT) : path.resolve(here, "..", "..");
const cacheDir = perfCacheDir(wtRoot);
const fixturesDir = process.env.PERF_FIXTURES_DIR ? path.resolve(process.env.PERF_FIXTURES_DIR) : path.join(cacheDir, "fixtures");
if (o.foreground || process.env.PERF_FOREGROUND === "1") process.env.VAULTDRAW_PERF_FOREGROUND = "1";
const mode = o["low-end"] ? "low-end" : "normal";
const leakOnly = !!(o["leak-only"] || process.env.PERF_LEAK_ONLY === "1");
const modes = { leak: leakOnly || !!(o.leak || process.env.PERF_LEAK === "1"), leakOnly, typical: !!(o.typical || o.ablate || o.everyday || process.env.PERF_TYPICAL === "1" || process.env.PERF_ABLATE === "1" || process.env.PERF_EVERYDAY === "1"), everyday: !!(o.everyday || process.env.PERF_EVERYDAY === "1"), ablate: !!(o.ablate || process.env.PERF_ABLATE === "1"), warmGapMs: Number(process.env.PERF_TYPICAL_GAP_MS) || undefined };
if (modes.ablate) process.env.PERF_MEM_TIMELINE = "1";
const variant = [modes.leakOnly ? "leak-only" : modes.leak && "leak", modes.typical && "typical", modes.everyday && "everyday", modes.ablate && "ablate", modes.warmGapMs && `gap${modes.warmGapMs}`].filter(Boolean).join("+");
const runs = o.quick ? 1 : Number(o.runs ?? (o.milestone ? 4 : 2));
const warmup = o.quick ? 0 : Number(o.warmup ?? (o.milestone ? 1 : 0));
// Packaged-app runs open windows on the user's screen: only on request or at milestones.
const skipApp = !!o["skip-app"] || !(o.app || o.milestone || modes.typical);
// The typical vault is app-only: the Chromium harness runs the stress vault.
const skipBrowser = !!o["skip-browser"] || modes.typical;
const log = (m) => console.error(`[perf] ${m}`);
const t0 = Date.now();
const elapsedMin = () => (Date.now() - t0) / 60000;

const catalogue = loadCatalogue();
const config = JSON.parse(readFileSync(path.join(here, "fixtures.config.json"), "utf8"));
const typicalConfig = JSON.parse(readFileSync(path.join(here, "typical.config.json"), "utf8"));
const errors = [];
const notes = [];
const rawApp = [];
const appOpenBreakdown = [];
let rawBrowser = [];
let browserScenarios;
let git = gitInfo(wtRoot);
let fixtureHash = createHash("sha256").update(JSON.stringify(config)).digest("hex").slice(0, 12);

// ---- quiet-machine gate ----
const load = await waitQuiet({
  threshold: o["quiet-load"] !== undefined ? Number(o["quiet-load"]) : DEFAULT_QUIET_LOAD,
  waitS: o["quiet-wait"] !== undefined ? Number(o["quiet-wait"]) : DEFAULT_QUIET_WAIT_S,
  log,
});
load.perRun = [];
const sampleRunLoad = () => { const l = loadAvg1(); if (Number.isFinite(l)) load.perRun.push(Math.round(l * 100) / 100); };
if (!load.quiet && o["require-quiet"]) {
  console.error(`[perf] machine not quiet after ${load.waitedS}s: ${loadSummary(load)}; exiting (--require-quiet)`);
  process.exit(1);
}

// Keep the display awake (and the session from idle-locking) for the whole run: a locked or
// sleeping screen hides the WebView, which stops requestAnimationFrame in the packaged app. (Not on Linux: Xvfb.)
if (!isLinux) try {
  spawn("caffeinate", ["-dimsu", "-t", "7200", "-w", String(process.pid)], { stdio: "ignore", detached: false }).on("error", () => {});
} catch { /* best effort */ }
const LOCKED_MSG = "screen is locked: the packaged app can't be measured (WebKit stops rendering hidden windows). Unlock the screen, or use --skip-app for Chromium-only numbers";

// a metric whose spec gates nothing in this mode (D9: packaged low-end open.<size>) never asks for extra runs
const gated = (id) => (specFor(catalogue, id, mode)?.gate.length ?? 0) > 0;
const gatedNoisy = (metrics) => Object.entries(metrics).some(([id, m]) => m.noisy && gated(id));

// ---- app mode ----
let appTarget = null;
let appAborted = null;
if (!skipApp && isScreenLocked()) {
  errors.push(`app mode: ${LOCKED_MSG}`);
  log(`app mode skipped: ${LOCKED_MSG}`);
} else if (!skipApp) {
  try {
    const { ensureVault } = await import(pathToFileURL(path.join(here, "lib", "fixtures.mjs")).href);
    const extra = await import(pathToFileURL(path.join(here, "lib", "extraVaults.mjs")).href);
    const { vaultDir, manifest } = modes.everyday
      ? await extra.ensureEverydayVault({ cacheDir: fixturesDir, config: typicalConfig })
      : modes.typical
      ? await extra.ensureTypicalVault({ cacheDir: fixturesDir, config: typicalConfig })
      : await ensureVault({ cacheDir: fixturesDir, config, log });
    if (manifest?.hash) fixtureHash = String(manifest.hash).slice(0, 12);
    const altVault = modes.leak ? (await extra.ensureAltVault({ cacheDir: fixturesDir, seed: config.seed })).vaultDir : undefined;
    const built = o["no-build"] ? reuseBuiltApp({ wtRoot }) : await buildPerfApp({ wtRoot, log });
    git = built.git ?? git;
    appTarget = {
      runOne: async (i) => {
        const r = await runAppOnce({
          appPath: built.appPath, pristineVault: vaultDir, lowEnd: mode === "low-end", runIndex: i,
          ...(isLinux ? { binary: built.binary, runsDir: path.join(cacheDir, "runs") } : {}),
          keepRuns: !!o["keep-runs"], memoryPressure: mode === "low-end" || !!o["memory-pressure"], log, modes, altVault, configToml: process.env.PERF_CONFIG_TOML ? readFileSync(process.env.PERF_CONFIG_TOML, "utf8") : undefined,
        });
        for (const n of r.notes) if (!notes.includes(n)) notes.push(n);
        return r;
      },
    };
  } catch (e) {
    errors.push(`app mode: ${e.message}`);
    log(`app mode failed: ${e.message}`);
  }
}

let hiddenAppRuns = 0;
async function collectApp(count, label) {
  for (let i = 0; i < count; i++) {
    if (isScreenLocked()) {
      errors.push(`app run: ${LOCKED_MSG}`);
      log(`app run aborted: ${LOCKED_MSG}`);
      return;
    }
    log(`app ${label} run ${i + 1}/${count} (${mode})`);
    if (label !== "warmup") sampleRunLoad();
    // where each open's time went (vaultdraw:open:* marks, report-only); kept
    // from failed runs too: a run that stalls later still timed its opens
    const keepBreakdown = (run) => {
      if (label !== "warmup" && run.info?.openBreakdown) appOpenBreakdown.push(run.info.openBreakdown);
    };
    let r = await appTarget.runOne(rawApp.length + i + (label === "warmup" ? 1000 : 0));
    if (r.errors.length) {
      // One retry: other sessions launch apps with the same bundle id and can quit ours from outside.
      const why = r.errors.join("; ");
      log(`app run failed (${why}); retrying once`);
      notes.push(`app ${label} run retried after: ${why}`);
      r = await appTarget.runOne(rawApp.length + i + 2000);
    }
    // one breakdown per run index: the retry's when there was one
    keepBreakdown(r);
    if (r.errors.length) {
      // A run that failed twice is incomplete: never mix its partial samples into the result.
      if (label !== "warmup" || isRafStall(r.errors)) errors.push(...r.errors.map((e) => `app ${label} run: ${e}`));
      if (isRafStall(r.errors)) {
        // The window stopped rendering (display asleep, screen locked, occluded): every further
        // run would stall too, so stop the app phase instead of collecting more partial runs.
        appAborted = `rAF stalled in an app ${label} run twice in a row (display asleep or window hidden?)`;
        log(`app mode aborted: ${appAborted}`);
        return;
      }
      notes.push(`app ${label} run ${i + 1} failed twice; its samples were discarded`);
      continue;
    }
    if (label === "warmup") continue;
    if (Object.keys(r.samples).length) rawApp.push(r.samples);
    if (r.info?.window?.hidden) hiddenAppRuns++;
    if (r.info?.memoryTimeline) notes.push(`memory timeline (MB, now/peak per process): ${r.info.memoryTimeline.map((t) => `${t.mark} ${Object.entries(t.procs).map(([k, v]) => `${k}=${v.now}/${v.peak}`).join(" ")}`).join(" | ")}`);
  }
}

if (appTarget) {
  await collectApp(warmup, "warmup");
  if (!appAborted) await collectApp(runs, "measured");
  let extra = 0;
  while (!appAborted && o.milestone && !o.quick && extra < 2 && rawApp.length && elapsedMin() < 5.5 && gatedNoisy(aggregate(rawApp, unitOf(catalogue)))) {
    extra++;
    log(`noisy gated metric(s); extra run ${extra}/2 (${elapsedMin().toFixed(1)} min elapsed)`);
    await collectApp(1, "measured");
  }
  if (extra) notes.push(`${extra} extra app run(s) added because of noise`);
}

// ---- browser mode ----
if (!skipBrowser) {
  const bf = path.join(here, "lib", "browser.mjs");
  if (!existsSync(bf)) {
    notes.push("browser mode skipped: lib/browser.mjs not present");
  } else {
    try {
      const { runBrowser } = await import(pathToFileURL(bf).href);
      const { ensureVault } = await import(pathToFileURL(path.join(here, "lib", "fixtures.mjs")).href);
      const { vaultDir } = await ensureVault({ cacheDir: fixturesDir, config, log });
      // runBrowser discards its own warmup runs and returns only measured ones.
      const r = await runBrowser({ mode, runs, warmup, vaultDir, config, wtRoot, build: !o["no-build"], leak: modes.leak, leakOnly: modes.leakOnly, scenarios: parseScenarioList(o.scenarios), skipScenarios: parseScenarioList(o["skip-scenarios"]), onRun: () => { if (!appTarget) sampleRunLoad(); }, log });
      for (const e of r.errors ?? []) errors.push(`browser mode: ${e}`);
      rawBrowser = (r.samplesPerRun ?? []).map((run) =>
        Object.fromEntries(Object.entries(run).map(([k, v]) => [k.startsWith("browser.") ? k : `browser.${k}`, v])));
      browserScenarios = scenarioNames(r.info);
      if (r.info) notes.push(`browser info: ${JSON.stringify(r.info)}`);
    } catch (e) {
      errors.push(`browser mode: ${e.message}`);
    }
  }
}

if ((o.scenarios || o["skip-scenarios"]) && !skipApp) notes.push("--scenarios/--skip-scenarios apply to Chromium mode only; the packaged app ran every scenario");
const metrics = {
  ...aggregate(rawApp, unitOf(catalogue)),
  ...aggregate(rawBrowser, unitOf(catalogue)),
};
for (const [id, m] of Object.entries(metrics)) if (!specFor(catalogue, id)) notes.push(`uncatalogued metric ${id} (not gated)`);
const noisyIds = Object.entries(metrics).filter(([id, m]) => m.noisy && gated(id)).map(([id]) => id);
if (noisyIds.length) notes.push(`still noisy: ${noisyIds.join(", ")}`);

load.end = Math.round((loadAvg1() || load.end) * 100) / 100;
const lnote = loadNote(load);
if (lnote) notes.push(lnote);

const result = {
  version: 1, mode, createdAt: new Date().toISOString(), git, machine: machineInfo(),
  config: { runs: rawApp.length || rawBrowser.length, warmup, fixtureHash, drawingCount: modes.typical ? 50 : config.drawingCount, ...(variant ? { variant } : {}) },
  load, metrics, raw: { app: rawApp, browser: rawBrowser, appOpenBreakdown }, notes, errors,
  ...(browserScenarios?.length ? { scenarios: browserScenarios } : {}),
  ...(appAborted ? { aborted: { app: appAborted } } : {}),
  ...(rawApp.length ? { window: { hiddenRuns: hiddenAppRuns, runs: rawApp.length } } : {}),
};

const outFile = o.out ? path.resolve(o.out) : path.join(cacheDir, "results", `${new Date().toISOString().replace(/[:.]/g, "-")}-${mode}${variant ? `-${variant}` : ""}.json`);
mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(result, null, 2) + "\n");

console.log(`\nVaultdraw perf - ${mode} - ${rawApp.length || rawBrowser.length} measured run(s) + ${warmup} warmup - ${git.sha.slice(0, 10)}${git.dirty ? " (dirty)" : ""}`);
console.log(resultTable(result, catalogue));
console.log(loadSummary(load));
for (const n of notes) console.log(`note: ${n}`);

let exitCode = 0;
if (o.compare) {
  const { baseline, warnings } = pickBaseline(JSON.parse(readFileSync(o.compare, "utf8")), mode, result.machine);
  for (const w of warnings) console.log(`WARNING: ${w}`);
  const cmp = compare(result, baseline, catalogue);
  console.log(`\nComparison vs ${o.compare}`);
  console.log(comparisonTable(cmp.rows));
  const pre = cmp.rows.filter((r) => r.status === "budget-preexisting");
  const warnBud = cmp.rows.filter((r) => r.status === "budget-warn");
  if (warnBud.length) console.log(`\nWARNING: ${warnBud.length} warn-only budget(s) above target: ${warnBud.map((r) => `${r.metric}.${r.stat}=${r.cur.toFixed(0)}`).join(", ")}`);
  if (pre.length) console.log(`\nWARNING: ${pre.length} budget breach(es) already present in the baseline (not failing): ${pre.map((r) => `${r.metric}.${r.stat}`).join(", ")}`);
  if (cmp.failing.length) console.log(`\nFAIL: ${cmp.failing.map((r) => `${r.metric}.${r.stat} (${r.status})`).join(", ")}`);
  exitCode = cmp.exitCode;
}
if (o["update-baseline"] && variant) {
  console.log(`\nbaseline NOT updated: ${variant} runs are opt-in diagnostics, not part of the gate baseline`);
} else if (o["update-baseline"] && errors.length) {
  console.log(`\nbaseline NOT updated: this run had errors (a baseline must come from a clean run)`);
} else if (o["update-baseline"]) {
  const r = updateBaseline(path.resolve(o["update-baseline"]), result, catalogue);
  console.log(`baseline updated: ${r.file} (+ ${r.md})`);
}
if (errors.length) {
  console.log(`\nERRORS:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  exitCode = 1;
}
console.log(`\nresult: ${outFile}\nelapsed: ${elapsedMin().toFixed(1)} min`);
process.exit(exitCode);
