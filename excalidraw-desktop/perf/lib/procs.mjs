// Process discovery + RSS / CPU-time sampling via ps. macOS; every Linux difference is an `isLinux` branch into linux.mjs.
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isLinux, listProcessesLinux, sampleProcsLinux, sampleFootprintLinux, webKitHelpersOf } from "./linux.mjs";

const run = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => resolve({ err, stdout: String(stdout ?? "") }));
  });

/**
 * macOS `ps -o time=` prints [[dd-]hh:]mm:ss.cc, i.e. CENTISECOND resolution (verified on Darwin 25), which is plenty
 * for a 10 s idle window (1 cs = 0.1% of one core over 10 s). Returns seconds, NaN when unparseable.
 */
export function parsePsTime(s) {
  const m = /^\s*(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)\s*$/.exec(s ?? "");
  if (!m) return NaN;
  const [, d, h, mi, sec] = m;
  return (Number(d ?? 0) * 24 + Number(h ?? 0)) * 3600 + Number(mi) * 60 + Number(sec);
}

/** Parse `ps -o pid=,rss=,time=` output into Map<pid, {rssKB, cpuSec}>. */
export function parsePsSample(text) {
  const out = new Map();
  for (const line of String(text).split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*$/.exec(line);
    if (!m) continue;
    out.set(Number(m[1]), { rssKB: Number(m[2]), cpuSec: parsePsTime(m[3]) });
  }
  return out;
}

/** Parse `ps -axo pid=,ppid=,comm=` into [{pid, ppid, comm}] (comm may contain spaces). */
export function parsePsList(text) {
  const out = [];
  for (const line of String(text).split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]), comm: m[3] });
  }
  return out;
}

export async function listProcesses() {
  if (isLinux) return listProcessesLinux();
  const { stdout } = await run("ps", ["-axo", "pid=,ppid=,comm="]);
  return parsePsList(stdout);
}

export const isWebKitHelper = (p) => /com\.apple\.WebKit\.(WebContent|GPU|Networking)\.xpc\/Contents\/MacOS\/com\.apple\.WebKit\.(WebContent|GPU|Networking)$/.test(p.comm);

export async function snapshotWebKitPids() {
  if (isLinux) return new Set(); // Linux helpers are children of the app: no pre-spawn snapshot needed
  return new Set((await listProcesses()).filter(isWebKitHelper).map((p) => p.pid));
}

/**
 * WebKit helpers of OUR app. They are XPC services launched by launchd (not children of the app) and macOS exposes no
 * responsible-pid without root, so ownership can't be verified. Heuristic: WebKit helper pids that did not exist in the
 * pre-spawn snapshot and are alive now. Caveat: another WebKit app (Safari, another perf/smoke run) launching in the
 * same window would be picked up too; run perf on a quiet machine and not concurrently with other WebKit apps.
 */
export async function discoverWebKitHelpers(beforeSet) {
  if (isLinux) throw new Error("discoverWebKitHelpers is macOS-only; use discoverLinuxHelpers(appPid)");
  return (await listProcesses()).filter((p) => isWebKitHelper(p) && !beforeSet.has(p.pid)).map((p) => p.pid);
}

/** Linux: WebKitGTK helpers of the app, verified by the parent-pid chain. [{pid, role}] with role webContent|network|gpu. */
export async function discoverLinuxHelpers(appPid) {
  return webKitHelpersOf(await listProcesses(), appPid);
}

/** Sample rss (KB) and cumulative cpu seconds. Dead pids are simply absent from the result. */
export async function sampleProcs(pids) {
  if (!pids.length) return new Map();
  if (isLinux) return sampleProcsLinux(pids);
  const { stdout } = await run("ps", ["-o", "pid=,rss=,time=", "-p", pids.join(",")]);
  return parsePsSample(stdout);
}

/** Parse `footprint -j` JSON into Map<pid, {footprint, peak}> (bytes). Entries without `auxiliary` counters are skipped. */
export function parseFootprintJson(text) {
  const out = new Map();
  let j;
  try { j = JSON.parse(text); } catch { return out; }
  const scale = Number(j["bytes per unit"]) || 1;
  for (const p of j.processes ?? []) {
    const a = p.auxiliary ?? {};
    const footprint = Number(a.phys_footprint ?? p.footprint);
    const peak = Number(a.phys_footprint_peak);
    if (!Number.isInteger(p.pid) || !Number.isFinite(footprint)) continue;
    out.set(p.pid, { footprint: footprint * scale, peak: Number.isFinite(peak) ? peak * scale : NaN });
  }
  return out;
}

/** phys_footprint and lifetime phys_footprint_peak (what Activity Monitor's Memory column is based on). ~50 ms, no root. */
export async function sampleFootprint(pids) {
  if (!pids.length) return new Map();
  if (isLinux) return sampleFootprintLinux(pids); // PSS now, VmHWM as the lifetime peak
  const dir = await mkdtemp(path.join(tmpdir(), "perf-footprint-"));
  const file = path.join(dir, "fp.json");
  try {
    await run("/usr/bin/footprint", [...pids.flatMap((p) => ["-p", String(p)]), "-j", file]);
    return parseFootprintJson(await readFile(file, "utf8"));
  } catch {
    return new Map();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function applyBackgroundPolicy(pid) {
  if (isLinux) return true; // the low-end scope / nice level is inherited by the helpers (linux.lowEndCommand)
  const { err } = await run("taskpolicy", ["-b", "-p", String(pid)]);
  return !err;
}

// ---- child tracking so nothing is left behind on exit / SIGINT ----
const tracked = new Set();
let hooked = false;
function killAll() {
  for (const c of tracked) {
    try { c.kill("SIGKILL"); } catch { /* gone */ }
  }
}
export function trackChild(child) {
  tracked.add(child);
  child.once("close", () => tracked.delete(child));
  if (!hooked) {
    hooked = true;
    process.on("exit", killAll);
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      process.on(sig, () => { killAll(); process.exit(130); });
    }
  }
  return child;
}

/**
 * Simulated memory pressure (`memory_pressure -S`, never the allocating mode). It needs root to flip the kernel knob
 * (sysctl kern.memorypressure_manual_trigger: Operation not permitted). Resolves a handle { stop(), note } where note
 * reports whether it could apply.
 */
export function startMemoryPressure({ seconds = 60, log = () => {} } = {}) {
  if (isLinux) {
    // No memory_pressure on Linux; the low-end scope's MemoryHigh is the stand-in (see linux.lowEndCommand).
    return { child: null, applied: false, stop() {}, note: () => "memory_pressure -S does not exist on Linux: skipped (low-end uses the cgroup MemoryHigh cap instead)" };
  }
  const child = trackChild(spawn("memory_pressure", ["-S", "-l", "warn", "-s", String(seconds)], { stdio: ["ignore", "pipe", "pipe"] }));
  let text = "";
  const onData = (d) => { if (text.length < 8192) text += d; };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("error", () => {});
  const handle = {
    child,
    get applied() { return !/not permitted|failed/i.test(text); },
    stop() { try { child.kill("SIGKILL"); } catch { /* gone */ } },
    note() {
      return handle.applied
        ? "memory_pressure -S active"
        : "memory_pressure -S could not apply (needs root: kern.memorypressure_manual_trigger not permitted); continued without it";
    },
  };
  return handle;
}
