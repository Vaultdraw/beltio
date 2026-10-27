// Build the perf .app, run it once against a cloned vault, collect live marks + node-side metrics.
import { spawn, execFile, execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { rm, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  snapshotWebKitPids, discoverWebKitHelpers, listProcesses, sampleProcs, sampleFootprint,
  applyBackgroundPolicy, trackChild, startMemoryPressure,
} from "./procs.mjs";
import { LEAK_PREFIX, leakSummary, leakTableText } from "./leak.mjs";

const BUNDLE_REL = "excalidraw-desktop/src-tauri/target/release/bundle/macos/Vaultdraw.app";
/**
 * Opt-in modes travel to the app in the run vault's folder name (read in-app by runDesktopPerf.modesFromVaultPath).
 * The default gate run keeps the plain name `vault`.
 */
export const vaultDirName = (modes = {}) =>
  ["vault", modes.leakOnly ? "leakonly" : modes.leak && "leak", modes.typical && "typical", modes.everyday && "everyday", modes.ablate && "ablate", modes.warmGapMs && `gap${modes.warmGapMs}`].filter(Boolean).join("+");

export const BINARY_REL = "Contents/MacOS/excalidraw-vault";
const MARK_PREFIX = "VAULTDRAW_SMOKE_LOG ";

const sh = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(String(stdout))));
  });

/** True when the macOS session's screen is locked (WKWebView then throttles rAF/timers). */
export function isScreenLocked() {
  try {
    const out = execFileSync("ioreg", ["-n", "Root", "-d1", "-a"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    return /CGSSessionScreenIsLocked<\/key>\s*<true\/>/.test(out);
  } catch { return false; }
}

/** A run whose window stopped producing frames (hidden, occluded, display asleep): its numbers are not real. */
export const isRafStall = (errors = []) => errors.some((e) => /rAF stalled/.test(String(e)));

export const perfCacheDir = (wtRoot) => path.join(wtRoot, ".cache", "perf");
export const perfAppPath = (wtRoot) => path.join(perfCacheDir(wtRoot), "app", "Vaultdraw.app");

export function gitInfo(wtRoot) {
  const g = (...a) => { try { return execFileSync("git", ["-C", wtRoot, ...a], { encoding: "utf8" }).trim(); } catch { return ""; } };
  return { sha: g("rev-parse", "HEAD"), branch: g("rev-parse", "--abbrev-ref", "HEAD"), dirty: g("status", "--porcelain").length > 0 };
}

/** Parse one stdout line; returns { step, ok, details } or null. */
export function parseSmokeLine(line) {
  const i = line.indexOf(MARK_PREFIX);
  if (i < 0) return null;
  try {
    const v = JSON.parse(line.slice(i + MARK_PREFIX.length));
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

function tail(file, n = 40) {
  try { return readFileSync(file, "utf8").split("\n").slice(-n).join("\n"); } catch { return ""; }
}

// Test builds get their own bundle id (app.vaultdraw.test), so window-manager rules and
// macOS treat them apart from the owner's real Vaultdraw.
const TEST_APP_CONFIG = "src-tauri/tauri.test.conf.json";

export async function buildPerfApp({ wtRoot, log = () => {} }) {
  const logDir = path.join(perfCacheDir(wtRoot), "logs");
  mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `build-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  const out = createWriteStream(logFile);
  const cwd = path.join(wtRoot, "excalidraw-desktop");
  log(`building perf app (log: ${logFile}) ...`);
  const t0 = Date.now();
  const code = await new Promise((resolve) => {
    const c = trackChild(spawn(process.execPath, ["../node_modules/@tauri-apps/cli/tauri.js", "build", "--features", "smoke-test", "--bundles", "app", "--config", TEST_APP_CONFIG], {
      cwd, env: { ...process.env, VITE_APP_PERF_TEST: "true" }, stdio: ["ignore", "pipe", "pipe"],
    }));
    c.stdout.pipe(out, { end: false });
    c.stderr.pipe(out, { end: false });
    c.on("error", () => resolve(-1));
    c.on("close", (k) => resolve(k ?? -1));
  });
  out.end();
  if (code !== 0) {
    throw new Error(`perf app build failed (exit ${code}); see ${logFile}\n--- tail ---\n${tail(logFile)}`);
  }
  const src = path.join(wtRoot, BUNDLE_REL);
  if (!existsSync(src)) throw new Error(`build finished but bundle missing: ${src}`);
  const dest = perfAppPath(wtRoot);
  await rm(dest, { recursive: true, force: true });
  await mkdir(path.dirname(dest), { recursive: true });
  await sh("cp", ["-cR", src, dest]);
  log(`build done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  return { appPath: dest, logFile, git: gitInfo(wtRoot), builtAt: new Date().toISOString() };
}

export function reuseBuiltApp({ wtRoot }) {
  const dest = perfAppPath(wtRoot);
  if (!existsSync(path.join(dest, BINARY_REL))) {
    throw new Error(`--no-build given but no perf app at ${dest}; run once without --no-build`);
  }
  return { appPath: dest, git: gitInfo(wtRoot), reused: true };
}

/**
 * Launch the app once. Returns { samples, info, errors, notes, marks, spawnWallMs, appPid, helperPids, runDir }.
 * Options: runsDir (default <cache>/runs), binary (override, used by tests), timeoutMs, keepRuns, memoryPressure,
 * configToml (text written to the temp config dir's config.toml, e.g. a copy of a user's appearance settings).
 */
export async function runAppOnce({
  appPath, pristineVault, lowEnd = false, runIndex = 0, runsDir, binary, timeoutMs, keepRuns = false,
  memoryPressure = lowEnd, log = () => {}, sampleEveryMs = 250, env: extraEnv = {}, configToml,
  modes = {}, altVault,
}) {
  const bin = binary ?? path.join(appPath, BINARY_REL);
  runsDir ??= path.join(path.dirname(path.dirname(appPath)), "runs");
  timeoutMs ??= (lowEnd ? 360_000 : 180_000) + (modes.leak ? 180_000 : 0) + (modes.ablate ? 240_000 : 0);
  const runDir = path.join(runsDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${runIndex}`);
  const vault = path.join(runDir, vaultDirName(modes));
  const vaultAlt = path.join(runDir, "vault-alt");
  const cfg = path.join(runDir, "config");
  const state = path.join(runDir, "state");
  await mkdir(runDir, { recursive: true });
  await mkdir(cfg, { recursive: true });
  await mkdir(state, { recursive: true });
  if (configToml) writeFileSync(path.join(cfg, "config.toml"), configToml);
  await sh("cp", ["-cR", pristineVault, vault]); // APFS clone
  // Leak mode: second vault for the in-app vault switch. The app only uses it when its smoke-mode
  // choose_vault honours EXCALIDRAW_VAULT_SMOKE_DIR_ALT (otherwise the scenario reports "unavailable").
  if (modes.leak && altVault) await sh("cp", ["-cR", altVault, vaultAlt]);

  const errors = [];
  const notes = [];
  const marks = [];
  const before = await snapshotWebKitPids();
  const env = { ...process.env, VAULTDRAW_PERF: "1", ...extraEnv, EXCALIDRAW_VAULT_SMOKE_DIR: vault, ...(modes.leak && altVault ? { EXCALIDRAW_VAULT_SMOKE_DIR_ALT: vaultAlt } : {}), VAULTDRAW_CONFIG_DIR: cfg, VAULTDRAW_STATE_DIR: state };
  // PERF_LOWEND_ROLES=app,webContent,gpu,network limits which processes get background QoS (attribution runs).
  const lowRoles = process.env.PERF_LOWEND_ROLES ? new Set(process.env.PERF_LOWEND_ROLES.split(",")) : null;
  const [cmd, args] = lowEnd && (!lowRoles || lowRoles.has("app")) ? ["taskpolicy", ["-c", process.env.PERF_LOWEND_APP_QOS || "background", bin]] : [bin, []];

  const mp = memoryPressure ? startMemoryPressure({ seconds: Math.ceil(timeoutMs / 1000), log }) : null;
  const spawnWallMs = Date.now();
  const child = trackChild(spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] }));
  const appPid = child.pid;
  // Display on and no idle sleep for the lifetime of the app (it exits on its own).
  try {
    const caf = trackChild(spawn("caffeinate", ["-dimsu", "-w", String(appPid)], { stdio: "ignore" }));
    caf.on("error", () => {});
  } catch { /* best effort */ }
  const screenLocked = isScreenLocked();
  if (screenLocked) {
    log("WARNING: screen is locked; numbers taken with a locked screen are less representative (window may be occluded)");
    notes.push("screen locked during run: numbers are less representative");
  }
  let appPidResolved = false;
  const helpers = new Set();
  let exactPids = false;
  let pidsInfo = null;
  let peakRssKB = 0;
  let interactiveSeen = false;
  let coldToInteractive;
  let idleBegin, idleEnd;
  let footprintAtEnd = null;
  let lastPhase = null;
  let lastHeartbeat = null;
  const pendingSlow = new Map();
  let stdoutTail = "";
  let stderrTail = "";
  let closed = false;

  const livePids = () => [appPid, ...helpers];
  // Opt-in (PERF_MEM_TIMELINE=1): footprint per process at each phase boundary, to attribute the peak.
  const memTimeline = process.env.PERF_MEM_TIMELINE === "1";
  const timeline = [];
  const leakCheckpoints = []; // always on in leak mode: { label, procs: { role: MB } }
  const footprintMB = (m) => Object.fromEntries([...m].map(([pid, v]) => [roleOf(pid), { now: Math.round(v.footprint / 1048576), peak: Math.round(v.peak / 1048576) }]));
  async function recordTimeline(mark) {
    if (!memTimeline) return;
    timeline.push({ mark, procs: footprintMB(await sampleFootprint(livePids())) });
    await dumpFootprints(mark);
  }
  // Diagnosis only (PERF_MEM_DUMP_DIR=<dir>): categorised `footprint` (MALLOC_*, IOSurface, WebKit malloc, ...) per process.
  async function dumpFootprints(mark) {
    const dir = process.env.PERF_MEM_DUMP_DIR;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    for (const pid of livePids()) {
      const out = await sh("/usr/bin/footprint", [...(process.env.PERF_MEM_DUMP_VERBOSE ? ["-v"] : []), "-p", String(pid)], { timeout: 20_000, maxBuffer: 64 << 20 }).catch((e) => `footprint failed: ${e.message}`);
      const base = path.join(dir, `${runIndex}-${String(timeline.length).padStart(2, "0")}-${mark.replace(/\W+/g, "_")}-${roleOf(pid)}`);
      writeFileSync(`${base}.txt`, out);
      // Live allocations by stack (launch with MallocStackLogging=lite in the environment).
      if (process.env.MallocStackLogging && pid === appPid) {
        const stacks = await sh("/usr/bin/malloc_history", [String(pid), "-allBySize"], { timeout: 60_000, maxBuffer: 256 << 20 }).catch((e) => `malloc_history failed: ${e.message}`);
        writeFileSync(`${base}-stacks.txt`, stacks.slice(0, 400_000));
      }
    }
  }
  async function rediscover() {
    if (exactPids) return;
    const found = await discoverWebKitHelpers(before);
    for (const pid of found) {
      if (helpers.has(pid)) continue;
      helpers.add(pid);
      if (lowEnd && !lowRoles) {
        const ok = await applyBackgroundPolicy(pid);
        if (!ok) notes.push(`taskpolicy -b -p ${pid} failed`);
      }
    }
  }
  async function verifyPid() {
    if (appPidResolved) return;
    appPidResolved = true;
    const procs = await listProcesses();
    const me = procs.find((p) => p.pid === appPid);
    if (me && /taskpolicy$/.test(me.comm)) {
      const kid = procs.find((p) => p.ppid === appPid);
      if (kid) { helpers.delete(kid.pid); notes.push(`taskpolicy did not exec; app pid is child ${kid.pid}`); }
    }
  }
  function roleOf(pid) {
    if (pid === appPid) return "app";
    for (const [role, id] of Object.entries(pidsInfo ?? {})) if (id === pid && role !== "app") return role;
    return `pid${pid}`;
  }
  async function sampleWithTime() {
    const t0 = performance.now();
    const m = await sampleProcs(livePids());
    return { m, t: (t0 + performance.now()) / 2 };
  }
  async function tick() {
    if (closed) return;
    const m = await sampleProcs(livePids());
    let sum = 0;
    for (const v of m.values()) sum += v.rssKB;
    if (sum > peakRssKB) peakRssKB = sum;
  }
  let tickN = 0;
  const timer = setInterval(() => {
    if (closed) return;
    tickN++;
    const work = (!interactiveSeen || tickN % 4 === 0) ? rediscover().then(tick) : tick();
    chain = chain.then(() => work).catch(() => {});
  }, sampleEveryMs);
  let chain = Promise.resolve();

  async function onMark(entry) {
    const name = entry?.details?.name;
    if (entry.step !== "perf-mark" || typeof name !== "string") return;
    marks.push({ name, wallMs: entry.details.wallMs, nodeMs: Date.now() });
    if (name.startsWith("phase:")) lastPhase = name;
    if (name === "heartbeat") lastHeartbeat = entry.details;
    if (name === "slow-ipc") pendingSlow.set(entry.details.id, entry.details);
    if (name === "slow-ipc-done") pendingSlow.delete(entry.details.id);
    if (name === "pids") {
      const p = entry.details.pids;
      const ids = p ? [p.webContent, p.network, p.gpu].filter((n) => Number.isInteger(n) && n > 0) : [];
      if (ids.length) {
        if (!exactPids) peakRssKB = 0; // earlier samples may have included other apps' helpers (pid-diff)
        exactPids = true;
        helpers.clear();
        for (const pid of ids) {
          if (helpers.has(pid)) continue;
          helpers.add(pid);
          const role = Object.entries(p).find(([, id]) => id === pid)?.[0];
          if (lowEnd && (!lowRoles || lowRoles.has(role))) {
            const ok = await applyBackgroundPolicy(pid);
            if (!ok) notes.push(`taskpolicy -b -p ${pid} failed`);
          }
        }
        pidsInfo = p;
      }
      return;
    }
    if (name.startsWith(LEAK_PREFIX)) {
      await rediscover();
      const m = await sampleFootprint(livePids());
      leakCheckpoints.push({
        label: name.slice(LEAK_PREFIX.length),
        procs: Object.fromEntries([...m].map(([pid, v]) => [roleOf(pid), Math.round((v.footprint / 1048576) * 10) / 10])),
      });
      return;
    }
    if (name === "interactive") {
      interactiveSeen = true;
      coldToInteractive = entry.details.wallMs - spawnWallMs;
      await verifyPid();
      await rediscover();
      await tick();
    } else if (name.startsWith("phase:")) {
      await rediscover();
      await recordTimeline(name);
    } else if (name === "idle-begin") {
      idleBegin = await sampleWithTime(); // sample first: the mark is the window boundary
      await rediscover();
      await recordTimeline(name);
    } else if (name === "idle-end") {
      idleEnd = await sampleWithTime();
      footprintAtEnd = await sampleFootprint(livePids());
      if (memTimeline) timeline.push({ mark: name, procs: footprintMB(footprintAtEnd) });
      await dumpFootprints(name);
    }
  }

  let buf = "";
  child.stdout.on("data", (d) => {
    const s = String(d);
    stdoutTail = (stdoutTail + s).slice(-4000);
    buf += s;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      const m = parseSmokeLine(line);
      if (m) chain = chain.then(() => onMark(m)).catch((e) => errors.push(`mark handler: ${e.message}`));
    }
  });
  child.stderr.on("data", (d) => { stderrTail = (stderrTail + d).slice(-4000); });

  let timedOut = false;
  let stallSampleFile = null;
  const killTimer = setTimeout(async () => {
    timedOut = true;
    // Where is the native side stuck? Sample the app for 3 s before killing it.
    try {
      const logDir = path.join(path.dirname(runsDir), "logs");
      mkdirSync(logDir, { recursive: true });
      stallSampleFile = path.join(logDir, `stall-sample-${path.basename(runDir)}.txt`);
      await sh("sample", [String(appPid), "3", "-file", stallSampleFile], { timeout: 20_000 });
    } catch (e) {
      stallSampleFile = stallSampleFile ? `${stallSampleFile} (sample failed: ${e.message})` : null;
    }
    try { child.kill("SIGKILL"); } catch { /* gone */ }
  }, timeoutMs);
  const exit = await new Promise((resolve) => {
    child.on("error", (e) => { errors.push(`spawn failed: ${e.message}`); resolve({ code: -1 }); });
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(killTimer);
  clearInterval(timer);
  closed = true;
  await chain.catch(() => {});
  mp?.stop();
  if (mp) notes.push(mp.note());

  if (timedOut) {
    const pend = [...pendingSlow.values()].map((d) => `${d.method}(${d.args}) pending ${d.pendingMs} ms`).join("; ");
    errors.push(`timeout after ${timeoutMs / 1000} s (app killed); last phase: ${lastPhase ?? "none"}; last heartbeat: ${lastHeartbeat ? `visibility=${lastHeartbeat.visibility} hasFocus=${lastHeartbeat.hasFocus} msSinceRaf=${lastHeartbeat.msSinceRaf}` : "none"}; pending slow IPC: ${pend || "none"}${stallSampleFile ? `; native sample: ${stallSampleFile}` : ""}`);
  }
  else if (exit.code !== 0) errors.push(`app exited with ${exit.signal ?? exit.code}`);

  const samples = {};
  let info = {};
  const reportFile = path.join(vault, "smoke-report.json");
  if (existsSync(reportFile)) {
    try {
      const report = JSON.parse(readFileSync(reportFile, "utf8"));
      if (report.status !== 0) errors.push(`in-app report status ${report.status}`);
      const perf = report.details?.perf;
      if (!perf) errors.push("smoke-report.json has no details.perf");
      else {
        Object.assign(samples, perf.samples ?? {});
        info = perf.info ?? {};
        for (const e of perf.errors ?? []) errors.push(`in-app: ${typeof e === "string" ? e : JSON.stringify(e)}`);
      }
    } catch (e) {
      errors.push(`unreadable smoke-report.json: ${e.message}`);
    }
  } else {
    errors.push("no smoke-report.json written");
  }

  if (coldToInteractive !== undefined) samples["startup.coldToInteractive"] = [coldToInteractive];
  else if (!timedOut) errors.push("no `interactive` mark seen");
  if (peakRssKB > 0) samples["memory.peakRssMB"] = [peakRssKB / 1024];
  if (footprintAtEnd?.size) {
    let peak = 0, current = 0, complete = true;
    for (const v of footprintAtEnd.values()) {
      if (Number.isFinite(v.peak)) peak += v.peak; else complete = false;
      current += v.footprint;
    }
    const MB = 1024 * 1024;
    if (complete) samples["memory.peakFootprintMB"] = [peak / MB];
    samples["memory.idleFootprintMB"] = [current / MB];
    notes.push(`footprint over ${footprintAtEnd.size}/${livePids().length} pids at idle-end (peak = sum of per-process lifetime peaks, an upper bound on the simultaneous peak)`);
  } else notes.push("footprint unavailable; memory.peakFootprintMB not measured");
  if (idleBegin && idleEnd) {
    const wallS = (idleEnd.t - idleBegin.t) / 1000;
    let cpu = 0;
    for (const [pid, a] of idleBegin.m) {
      const b = idleEnd.m.get(pid);
      if (b && Number.isFinite(a.cpuSec) && Number.isFinite(b.cpuSec)) cpu += b.cpuSec - a.cpuSec;
    }
    if (wallS > 0) {
      samples["idle.cpuPercent"] = [(cpu / wallS) * 100];
      info.idleWindowS = wallS; // so cpuPercent can be turned back into CPU seconds (tests, diagnostics)
    }
  } else {
    notes.push("idle marks missing; idle.cpuPercent not measured");
  }
  if (leakCheckpoints.length) {
    const { samples: leakSamples, rows, notes: leakNotes } = leakSummary(leakCheckpoints);
    Object.assign(samples, leakSamples);
    info.leakCheckpoints = rows;
    notes.push(`leak checkpoints (footprint MB per process):\n${leakTableText(rows)}`, ...leakNotes);
  } else if (modes.leak) {
    errors.push("leak mode: no leak checkpoints were recorded");
  }
  // Per-process breakdown (app / webContent / network / gpu) so a budget breach points at its owner.
  const breakdown = {};
  if (memTimeline) info.memoryTimeline = timeline;
  for (const [pid, v] of footprintAtEnd ?? []) {
    breakdown[roleOf(pid)] = { peakFootprintMB: Math.round(v.peak / 1048576), footprintMB: Math.round(v.footprint / 1048576) };
  }
  if (idleBegin && idleEnd) {
    const wallS = (idleEnd.t - idleBegin.t) / 1000;
    for (const [pid, a] of idleBegin.m) {
      const b = idleEnd.m.get(pid);
      if (!b || !(wallS > 0)) continue;
      (breakdown[roleOf(pid)] ??= {}).idleCpuPercent = Math.round(((b.cpuSec - a.cpuSec) / wallS) * 1000) / 10;
    }
  }
  info.processBreakdown = breakdown;
  if (modes.typical && footprintAtEnd?.size) {
    // Per-process idle footprint of a typical vault, for comparison with other note apps.
    let total = 0;
    for (const [pid, v] of footprintAtEnd) {
      const mb = v.footprint / 1048576;
      total += mb;
      samples[`memory.typical.idle.${roleOf(pid)}MB`] = [Math.round(mb * 10) / 10];
    }
    samples["memory.typical.idleFootprintMB"] = [Math.round(total * 10) / 10];
  }
  if (Object.keys(breakdown).length) notes.push(`per process: ${JSON.stringify(breakdown)}`);
  if (exactPids) notes.push(`WebKit helpers from perf_process_ids (exact): ${helpers.size}`);
  else if (helpers.size) notes.push(`perf_process_ids unavailable; WebKit helpers attributed by pid-diff (${helpers.size}; may include other apps' helpers)`);
  else notes.push("no WebKit helper processes discovered (RSS/CPU cover the app process only)");

  if (errors.length && (stderrTail || stdoutTail)) {
    notes.push(`app output tail: ${(stderrTail || stdoutTail).trim().split("\n").slice(-6).join(" | ")}`);
  }
  if (!keepRuns) await rm(runDir, { recursive: true, force: true });
  return { samples, info, errors, notes, marks, spawnWallMs, appPid, screenLocked, helperPids: [...helpers], runDir: keepRuns ? runDir : undefined };
}
