#!/usr/bin/env node
// Runs the packaged trial app (built with --features smoke-test and VITE_APP_OBSIDIAN_TRIAL=true) once:
// it imports the Obsidian vault at --src into a new vault at --out and opens a sample of the drawings.
// Samples the memory of the app and its WebKit helpers every 250 ms. Prints one JSON summary.
// --mode inplace: opens --src as a vault in place instead (no --out).
// Usage: node scripts/obsidian-trial.mjs --app <Vaultdraw.app> --src <vault copy> --out <new vault> --run <scratch dir>
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { discoverWebKitHelpers, sampleFootprint, snapshotWebKitPids, trackChild } from "../perf/lib/procs.mjs";
import { parseSmokeLine } from "../perf/lib/app.mjs";

const arg = (k) => process.argv[process.argv.indexOf(`--${k}`) + 1];
const [appPath, src, out, run] = ["app", "src", "out", "run"].map(arg);
if (!appPath || !src || !run || (!out && arg("mode") !== "inplace")) throw new Error("usage: --app --src --out --run");
const inplace = arg("mode") === "inplace"; // open --src itself as the vault (use a copy: it gets .excalidraw-vault/)
const vault = inplace ? src : path.join(run, "host-vault");
const cfg = path.join(run, "config");
const state = path.join(run, "state");
for (const d of [vault, cfg, state]) mkdirSync(d, { recursive: true });
writeFileSync(path.join(cfg, "config.toml"), '[plugins]\nenabled = ["markdown-import"]\n');
const env = {
  ...process.env,
  EXCALIDRAW_VAULT_SMOKE_DIR: vault,
  VAULTDRAW_CONFIG_DIR: cfg,
  VAULTDRAW_STATE_DIR: state,
  ...(inplace ? { VAULTDRAW_PERF_SUITE: "inplace" } : { VAULTDRAW_TRIAL_SRC: src, VAULTDRAW_TRIAL_OUT: out }),
};
const before = await snapshotWebKitPids();
const child = trackChild(spawn(path.join(appPath, "Contents/MacOS/excalidraw-vault"), [], { env, stdio: ["ignore", "pipe", "pipe"] }));
const t0 = Date.now();
const marks = {};
let finish = null;
let buf = "";
child.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    const rec = parseSmokeLine(line);
    if (rec?.step === "perf-mark") marks[rec.details.name] = Date.now() - t0;
    if (rec && rec.step !== "perf-mark" && /finish|smoke-report/.test(rec.step ?? "")) finish = rec;
    if (line.includes("trial")) console.error(line.slice(0, 600));
  }
});
let stderr = "";
child.stderr.on("data", (d) => (stderr += d));
let closed = false;
let code = null;
child.on("close", (c) => ((closed = true), (code = c)));
const peak = { total: 0, atImportEnd: 0 };
// Fallback end-of-import signal that doesn't depend on the toast (a new-vault import reloads the window, so the
// in-page waiter can miss it): the --out folder stops growing for 15 s. Then 20 s of idle samples, then stop.
const countFiles = (d) => { let n = 0; try { for (const e of readdirSync(d, { withFileTypes: true })) n += e.isDirectory() ? countFiles(path.join(d, e.name)) : 1; } catch {} return n; };
let outCount = 0, outFirstAt = null, outLastGrowAt = null, outPollAt = 0, stoppedBy = null;
const series = [];
const deadline = Date.now() + 45 * 60_000;
while (!closed && Date.now() < deadline) {
  const helpers = await discoverWebKitHelpers(before);
  const fp = await sampleFootprint([child.pid, ...helpers]);
  const total = [...fp.values()].reduce((a, v) => a + v.footprint, 0) / 1048576;
  if (total > peak.total) peak.perProcess = [...fp.entries()].map(([pid, v]) => [pid === child.pid ? "app" : `helper${pid}`, Math.round(v.footprint / 1048576)]);
  peak.total = Math.max(peak.total, total);
  series.push([Date.now() - t0, Math.round(total)]);
  if (out && Date.now() - outPollAt > 2000) {
    outPollAt = Date.now();
    const n = countFiles(out);
    if (n !== outCount) { outCount = n; outLastGrowAt = Date.now() - t0; outFirstAt ??= outLastGrowAt; }
    if (outCount > 0 && marks["trial:import-begin"] && Date.now() - t0 - outLastGrowAt > 35_000) { stoppedBy = "out-quiet"; break; }
  }
  await new Promise((r) => setTimeout(r, 250));
}
if (!closed) child.kill("SIGKILL");
const at = (ms) => (series.find(([t]) => t >= ms) ?? series.at(-1) ?? [0, 0])[1];
const summary = {
  exit: code,
  marks,
  peakTotalMB: Math.round(peak.total),
  stoppedBy,
  peakPerProcessMB: peak.perProcess,
  outFiles: outCount,
  outFirstFileAtMs: outFirstAt,
  outLastGrowAtMs: outLastGrowAt,
  importMsFromOut: outFirstAt != null ? outLastGrowAt - outFirstAt : null,
  memAtOutLastGrowMB: outLastGrowAt != null ? at(outLastGrowAt) : null,
  memIdleAfterMB: series.at(-1)?.[1] ?? null,
  seriesEvery5s: series.filter((_, i) => i % 20 === 0),
  memAtImportBeginMB: marks["trial:import-begin"] ? at(marks["trial:import-begin"]) : null,
  memAtImportEndMB: marks["trial:import-end"] ? at(marks["trial:import-end"]) : null,
  memAtEndMB: series.at(-1)?.[1] ?? null,
  report: existsSync(path.join(vault, "smoke-report.json")) ? JSON.parse(readFileSync(path.join(vault, "smoke-report.json"), "utf8")) : null,
  stderrTail: stderr.slice(-800),
};
console.log(JSON.stringify(summary, null, 1));
