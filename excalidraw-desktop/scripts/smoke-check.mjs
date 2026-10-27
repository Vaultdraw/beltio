// Strict pass rule for one packaged smoke launch. The gate is the exit code of library-smoke.sh,
// which calls this once per launch: node smoke-check.mjs <label> <launch-exit> <report.json> [state-dir]
// A launch passes only if the app exited 0, the report exists with steps and 0 failed ones,
// details.perf.errors is empty (no "rAF stalled", no timeouts) and the window stayed visible.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { windowSummary, parseWindowStateLog } from "../perf/lib/windowState.mjs";

/** @returns {string[]} reasons the launch is invalid or failed (empty = pass) */
export function checkLaunch({ exitCode, report, windowLog = "" }) {
  const why = [];
  if (exitCode !== 0) why.push(`app exited ${exitCode}`);
  if (!report) return [...why, "no smoke report"];
  const a = report.details || report;
  const steps = report.steps || a.records || [];
  if (!steps.length) why.push("report has no steps");
  const failed = steps.filter((s) => !s.ok);
  if (failed.length) why.push(`${failed.length} failed step(s): ${failed.slice(0, 3).map((s) => s.step).join(", ")}`);
  const errs = a.perf?.errors ?? [];
  if (errs.length) why.push(`perf errors: ${errs.slice(0, 2).join("; ")}`);
  const w = windowSummary({ visibilities: [], native: parseWindowStateLog(windowLog) });
  if (w.hidden) why.push(`INVALID: window hidden (${w.offScreenSamples} off-screen, ${w.occludedSamples} occluded samples)`);
  if (errs.some((e) => /rAF stalled|hidden|occluded/.test(String(e)))) why.push("INVALID: window hidden or rendering stalled");
  return why;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [label, code, file, stateDir] = process.argv.slice(2);
  let report = null;
  try { report = JSON.parse(readFileSync(file, "utf8")); } catch { /* missing or partial */ }
  const wl = stateDir && existsSync(path.join(stateDir, "window-state.jsonl")) ? readFileSync(path.join(stateDir, "window-state.jsonl"), "utf8") : "";
  const why = checkLaunch({ exitCode: Number(code), report, windowLog: wl });
  console.log(why.length ? `SMOKE ${label}: FAIL - ${why.join(" | ")}` : `SMOKE ${label}: PASS`);
  process.exit(why.length ? 1 : 0);
}
