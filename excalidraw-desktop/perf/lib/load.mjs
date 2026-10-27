// Machine-load helpers: the quiet-machine gate used before perf measurements.
import { execFileSync } from "node:child_process";
import os from "node:os";
import { isLinux } from "./linux.mjs";

export const DEFAULT_QUIET_LOAD = 3.5;
export const DEFAULT_QUIET_WAIT_S = 300;

/** Parse `sysctl -n vm.loadavg` output ("{ 7.52 10.02 8.02 }") to the 1-minute load, NaN if unparsable. */
export function parseLoadAvg(text) {
  const m = /^\s*\{?\s*([\d.]+)/.exec(String(text ?? ""));
  return m ? Number(m[1]) : NaN;
}

export function loadAvg1() {
  if (isLinux) return os.loadavg()[0]; // /proc/loadavg; the macOS path keeps its sysctl probe
  try {
    return parseLoadAvg(execFileSync("sysctl", ["-n", "vm.loadavg"], { encoding: "utf8" }));
  } catch {
    return NaN;
  }
}

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * Wait until the 1-min load is below threshold, up to waitS seconds (wall clock, 0 = no wait).
 * Injectable sample/sleep/now for tests. Returns { threshold, waitedS, quiet, start, end }.
 */
export async function waitQuiet({
  threshold = DEFAULT_QUIET_LOAD, waitS = DEFAULT_QUIET_WAIT_S, pollS = 10,
  sample = loadAvg1, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, log = () => {},
} = {}) {
  const t0 = now();
  const start = sample();
  let cur = start;
  // NaN (sysctl unavailable) counts as quiet: never block on a broken probe.
  const isQuiet = (l) => !(l >= threshold);
  while (!isQuiet(cur) && (now() - t0) / 1000 < waitS) {
    log(`load ${cur} >= ${threshold}; waiting (${Math.round((now() - t0) / 1000)}s of ${waitS}s)`);
    await sleep(Math.min(pollS, Math.max(0.01, waitS - (now() - t0) / 1000)) * 1000);
    cur = sample();
  }
  return { threshold, waitedS: Math.round((now() - t0) / 1000), quiet: isQuiet(cur), start: round2(start), end: round2(cur) };
}

/** Note text when any sample was above the threshold, else null. */
export function loadNote(load) {
  const above = [load.start, load.end, ...(load.perRun ?? [])].filter((l) => l >= load.threshold);
  if (!above.length && load.quiet) return null;
  const peak = Math.max(...[load.start, load.end, ...(load.perRun ?? [])].filter(Number.isFinite));
  return `measured under load: peak 1-min load ${peak} vs threshold ${load.threshold} (waited ${load.waitedS}s); prefer cpu/count metrics, rerun when quiet`;
}

export const loadSummary = (load) =>
  `load ${load.start}->${load.end}${load.perRun?.length ? ` (runs ${load.perRun.join("/")})` : ""} ${load.quiet ? "quiet" : "NOT quiet"} (<${load.threshold}, waited ${load.waitedS}s)`;
