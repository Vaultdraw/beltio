// Linux twins of the macOS-only probes (procs.mjs, app.mjs, load.mjs, report.mjs). Every caller
// branches on `isLinux`; nothing here runs on macOS. The app under test is the plain release
// binary (no .app bundle), its WebKitGTK helpers are children of the app process (found by the
// parent-pid chain; the bubblewrap sandbox adds a `bwrap` hop), process samples come from /proc.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const isLinux = process.platform === "linux";

/** Default perf binary: $PERF_APP_BIN, else <$CARGO_TARGET_DIR or src-tauri/target>/release/excalidraw-vault. */
export function linuxPerfBinary(wtRoot, env = process.env) {
  if (env.PERF_APP_BIN) return path.resolve(env.PERF_APP_BIN);
  const target = env.CARGO_TARGET_DIR
    ? path.resolve(env.CARGO_TARGET_DIR)
    : path.join(wtRoot, "excalidraw-desktop", "src-tauri", "target");
  return path.join(target, "release", "excalidraw-vault");
}

// ---- /proc parsers (pure) ----

/** `/proc/<pid>/stat`: user + system CPU seconds (fields 14 and 15, after the parenthesised comm). NaN when unparseable. */
export function parseProcStat(text, clkTck = 100) {
  const s = String(text ?? "");
  const close = s.lastIndexOf(")");
  if (close < 0) return NaN;
  const f = s
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  // After ")" the fields start at index 3 (state): utime is field 14 -> f[11], stime field 15 -> f[12].
  const utime = Number(f[11]);
  const stime = Number(f[12]);
  return Number.isFinite(utime) && Number.isFinite(stime)
    ? (utime + stime) / clkTck
    : NaN;
}

/** `/proc/<pid>/status`: { rssKB (VmRSS), hwmKB (VmHWM, the lifetime peak RSS) }; NaN for missing lines. */
export function parseProcStatus(text) {
  const grab = (key) => {
    const m = new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, "m").exec(
      String(text ?? ""),
    );
    return m ? Number(m[1]) : NaN;
  };
  return { rssKB: grab("VmRSS"), hwmKB: grab("VmHWM") };
}

/** `/proc/<pid>/smaps_rollup`: proportional set size in KB (shared pages split between sharers), NaN if absent. */
export function parseSmapsRollup(text) {
  const m = /^Pss:\s+(\d+)\s+kB/m.exec(String(text ?? ""));
  return m ? Number(m[1]) : NaN;
}

let clkTck;
function clockTicks() {
  if (clkTck) return clkTck;
  try {
    clkTck =
      Number(
        execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim(),
      ) || 100;
  } catch {
    clkTck = 100;
  }
  return clkTck;
}

const readProc = (pid, file) => {
  try {
    return readFileSync(`/proc/${pid}/${file}`, "utf8");
  } catch {
    return null;
  }
};

/** Twin of procs.sampleProcs: Map<pid, {rssKB, cpuSec}> from /proc (10 ms CPU resolution; dead pids absent). */
export function sampleProcsLinux(pids) {
  const out = new Map();
  const tck = clockTicks();
  for (const pid of pids) {
    const stat = readProc(pid, "stat");
    const status = readProc(pid, "status");
    if (stat === null || status === null) continue;
    out.set(pid, {
      rssKB: parseProcStatus(status).rssKB,
      cpuSec: parseProcStat(stat, tck),
    });
  }
  return out;
}

/**
 * Twin of procs.sampleFootprint: Map<pid, {footprint, peak}> in bytes. footprint = PSS (smaps_rollup; RSS when
 * unreadable), peak = VmHWM (lifetime peak RSS: an upper bound, since PSS <= RSS).
 */
export function sampleFootprintLinux(pids) {
  const out = new Map();
  for (const pid of pids) {
    const status = readProc(pid, "status");
    if (status === null) continue;
    const { rssKB, hwmKB } = parseProcStatus(status);
    const pssKB = parseSmapsRollup(readProc(pid, "smaps_rollup"));
    const footprintKB = Number.isFinite(pssKB) ? pssKB : rssKB;
    if (!Number.isFinite(footprintKB)) continue;
    out.set(pid, {
      footprint: footprintKB * 1024,
      peak: Number.isFinite(hwmKB) ? hwmKB * 1024 : NaN,
    });
  }
  return out;
}

// ---- process tree ----

/** Pids of every descendant of rootPid in a [{pid, ppid}] list (children, grandchildren, ...). Pure. */
export function descendantsOf(list, rootPid) {
  const byParent = new Map();
  for (const p of list) {
    if (!byParent.has(p.ppid)) byParent.set(p.ppid, []);
    byParent.get(p.ppid).push(p);
  }
  const out = [];
  const stack = [rootPid];
  const seen = new Set();
  while (stack.length) {
    const pid = stack.pop();
    for (const kid of byParent.get(pid) ?? []) {
      if (seen.has(kid.pid)) continue;
      seen.add(kid.pid);
      out.push(kid);
      stack.push(kid.pid);
    }
  }
  return out;
}

/** WebKitGTK helper role from a command line (`.../WebKitWebProcess 12 34`), or null. */
export function webKitGtkRole(comm) {
  // First token only: a bwrap wrapper names the helper as an argument.
  const m = /^(?:\S*\/)?WebKit(Web|Network|GPU)Process(?:\s|$)/.exec(
    String(comm ?? ""),
  );
  return m ? { Web: "webContent", Network: "network", GPU: "gpu" }[m[1]] : null;
}

/** Twin of procs.listProcesses on Linux: `ps -axo pid=,ppid=,args=` (args, because `comm` is cut to 15 characters). */
export function listProcessesLinux() {
  let text = "";
  try {
    text = execFileSync("ps", ["-axo", "pid=,ppid=,args="], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]), comm: m[3] });
  }
  return out;
}

/** WebKitGTK helpers of OUR app: descendants of appPid whose command is a WebKit*Process. [{pid, role}]. Pure given the list. */
export function webKitHelpersOf(list, appPid) {
  return descendantsOf(list, appPid)
    .map((p) => ({ pid: p.pid, role: webKitGtkRole(p.comm) }))
    .filter((p) => p.role)
    .sort((a, b) => a.pid - b.pid);
}

// ---- low-end mode ----

/**
 * How the app is launched in low-end mode. systemd: a transient user scope with a CPU quota and a soft memory cap
 * (the WebKit helpers are children, so they share it); fallback: nice 19 pinned to two CPUs (same inheritance).
 * Returns { cmd, args, note }. Pure; `systemd` says whether `systemd-run --user --scope` works here.
 */
export function lowEndCommand(
  bin,
  { systemd, cpuQuota = "25%", memoryHigh = "1G", cpus = "0-1" } = {},
) {
  if (systemd) {
    return {
      cmd: "systemd-run",
      args: [
        "--user",
        "--scope",
        "--quiet",
        "-p",
        `CPUQuota=${cpuQuota}`,
        "-p",
        `MemoryHigh=${memoryHigh}`,
        "--",
        bin,
      ],
      note: `low-end (Linux): systemd-run --user --scope CPUQuota=${cpuQuota} MemoryHigh=${memoryHigh} (cgroup, inherited by the WebKit helpers)`,
    };
  }
  return {
    cmd: "nice",
    args: ["-n", "19", "taskset", "-c", cpus, bin],
    note: `low-end (Linux): systemd-run unavailable; nice -n 19 + taskset -c ${cpus} (inherited by the WebKit helpers)`,
  };
}

/** True when a transient user scope can be created here (needs a user systemd instance and XDG_RUNTIME_DIR). */
export function systemdRunWorks() {
  try {
    execFileSync(
      "systemd-run",
      ["--user", "--scope", "--quiet", "--", "true"],
      { stdio: "ignore", timeout: 10_000 },
    );
    return true;
  } catch {
    return false;
  }
}

// ---- machine ----

/** Vendor / model line from /proc/cpuinfo or lscpu text; "" when neither names the CPU. Pure. */
export function parseCpuBrand(cpuinfo, lscpu = "") {
  const model = /^model name\s*:\s*(.+)$/m
    .exec(String(cpuinfo ?? ""))?.[1]
    ?.trim();
  if (model) return model;
  const vendor = /^Vendor ID:\s*(.+)$/m.exec(String(lscpu ?? ""))?.[1]?.trim();
  const name = /^Model name:\s*(.+)$/m.exec(String(lscpu ?? ""))?.[1]?.trim();
  return [vendor, name && name !== "-" ? name : ""].filter(Boolean).join(" ");
}

/** The memory the app can really use: the cgroup limit when one is set (`memory.max`), else MemTotal. Pure. */
export function parseMemBytes(meminfo, cgroupMax) {
  const total =
    Number(/^MemTotal:\s+(\d+)\s+kB/m.exec(String(meminfo ?? ""))?.[1]) *
      1024 || 0;
  const cg = Number(String(cgroupMax ?? "").trim());
  return Number.isFinite(cg) && cg > 0 && (!total || cg < total) ? cg : total;
}

const readText = (f) => {
  try {
    return readFileSync(f, "utf8");
  } catch {
    return "";
  }
};

/** Twin of report.machineInfo. `platform: "linux"` makes machineLines print the right OS name. */
export function machineInfoLinux() {
  let lscpu = "";
  try {
    lscpu = execFileSync("lscpu", [], { encoding: "utf8" });
  } catch {
    /* optional */
  }
  const memBytes = parseMemBytes(
    readText("/proc/meminfo"),
    readText("/sys/fs/cgroup/memory.max"),
  );
  const pretty =
    /^PRETTY_NAME="?([^"\n]+)"?/m.exec(readText("/etc/os-release"))?.[1] ??
    "Linux";
  const brand = `${
    parseCpuBrand(readText("/proc/cpuinfo"), lscpu) || os.arch()
  } (${os.arch()})`;
  const webkit = webKitGtkVersion();
  return {
    platform: "linux",
    screenLocked: false,
    brand,
    memBytes,
    memGB: Math.round((memBytes / 2 ** 30) * 10) / 10,
    os: `${pretty} ${os.release()}${webkit ? `, WebKitGTK ${webkit}` : ""}${
      process.env.DISPLAY ? `, DISPLAY ${process.env.DISPLAY}` : ""
    }`,
    perfCores: os.cpus().length,
    efficiencyCores: 0,
  };
}

/** Installed WebKitGTK version from dpkg (Debian/Ubuntu) or pkg-config; "" when unknown. */
export function webKitGtkVersion() {
  try {
    return execFileSync("pkg-config", ["--modversion", "webkit2gtk-4.1"], {
      encoding: "utf8",
    }).trim();
  } catch {
    /* next */
  }
  try {
    const out = execFileSync(
      "dpkg-query",
      ["-W", "-f=${Version}", "libwebkit2gtk-4.1-0"],
      { encoding: "utf8" },
    ).trim();
    return out.split("-")[0];
  } catch {
    return "";
  }
}

/** True when the binary exists (the macOS path checks the .app's Contents/MacOS binary instead). */
export const binaryExists = (bin) => existsSync(bin);
