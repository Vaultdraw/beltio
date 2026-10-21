#!/usr/bin/env node
// Refresh-rate probe: real frames per second of the packaged app while zooming and panning,
// per paper pattern (plain, grid, dots, isometric) and drawing size (0 / 200 / 2,000 elements),
// with native trackpad input (pinch, two-finger scroll) and synthetic DOM input. One app launch.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";

import { buildPerfApp, isScreenLocked, perfCacheDir, reuseBuiltApp, runAppOnce } from "./lib/app.mjs";
import { paperVariants, refreshRateScenes } from "./lib/fixtures.mjs";

const HELP = `Usage: node excalidraw-desktop/perf/refresh-rate.mjs [--no-build] [--out file.json] [--label text] [--config config.toml]

--drawing copies a real .excalidraw (read only) into the probe vault once per paper style (same content,
pattern swapped: user-<style>.excalidraw) and measures it first; --drawing-only skips the generated drawings.
--config copies a config.toml (e.g. ~/.config/vaultdraw/config.toml: theme, dark mode, canvas sync) into the
run's temp config dir; the file itself is only read.

Builds the perf app (smoke-test feature, temp config/state dirs; never the user's), launches it once
(~1-2 min, the window opens in the background) and prints effective fps / rendered Hz per scenario.
Exit 1 if a native zoom or pan pass falls below 110 fps (or 100 drawn Hz) on a 120 Hz screen, 2 if the screen is locked.
Wrap in the shared build lock:
  lockf -k /Users/kalon/Opensource/excalidraw/.cache/build.lock node excalidraw-desktop/perf/refresh-rate.mjs
`;

const { values: o } = parseArgs({
  options: {
    "no-build": { type: "boolean" }, out: { type: "string" }, label: { type: "string" }, config: { type: "string" }, drawing: { type: "string" }, "drawing-only": { type: "boolean" },
    "keep-runs": { type: "boolean" }, help: { type: "boolean", short: "h" },
  },
});
if (o.help) {
  console.log(HELP);
  process.exit(0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const wtRoot = path.resolve(here, "..", "..");
const cacheDir = perfCacheDir(wtRoot);
const log = (m) => console.error(`[refresh-rate] ${m}`);
const BUDGET_FPS = 110;

if (isScreenLocked()) {
  log("screen is locked: WebKit stops rendering, the probe can't measure anything. Unlock and retry.");
  process.exit(2);
}

const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};
/** Power source and Low Power Mode: ProMotion may drop to 60 Hz in Low Power Mode. */
function environment() {
  const batt = sh("pmset", ["-g", "batt"]);
  const settings = sh("pmset", ["-g"]);
  const lowPower = /(?:lowpowermode|powermode)\s+(\d)/.exec(settings);
  return {
    macOS: `${sh("sw_vers", ["-productVersion"])} (${sh("sw_vers", ["-buildVersion"])})`,
    cpu: sh("sysctl", ["-n", "machdep.cpu.brand_string"]),
    powerSource: /'([^']+)'/.exec(batt)?.[1] ?? "unknown",
    battery: /(\d+%;[^;]*)/.exec(batt)?.[1] ?? "",
    lowPowerMode: lowPower ? lowPower[1] !== "0" : null,
  };
}

const config = JSON.parse(readFileSync(path.join(here, "fixtures.config.json"), "utf8"));

const PAPER_STYLES = ["plain", "grid", "lines", "dots", "graph", "isometric"];
const extraScenes = o.drawing ? paperVariants(readFileSync(o.drawing, "utf8"), PAPER_STYLES) : [];

/** A small vault with just the probe drawings (cached by content hash). */
async function ensureProbeVault() {
  const scenes = [...refreshRateScenes(config), ...extraScenes];
  const hash = createHash("sha1").update(scenes.map((s) => s.json).join("\n")).digest("hex").slice(0, 12);
  const dir = path.join(cacheDir, `refresh-rate-vault-${hash}`);
  try {
    await fs.access(path.join(dir, ".complete"));
    return dir;
  } catch { /* build it */ }
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  for (const s of scenes) await fs.writeFile(path.join(dir, s.rel), s.json);
  await fs.writeFile(path.join(dir, ".complete"), hash);
  return dir;
}

const pad = (v, n) => String(v).padStart(n);
function table(passes) {
  const lines = [
    `${"drawing".padEnd(20)} ${"input".padEnd(15)} ${pad("fps", 6)} ${pad("drawnHz", 7)} ${pad("<=9ms%", 6)} ${pad("p95ms", 6)} ${pad("drop", 5)} ${pad("inHz", 6)} ${pad("inFrHz", 6)} ${pad("multi", 5)} ${pad("jsP50", 6)} ${pad("jsP95", 6)} ${pad("js%", 5)} ${pad("cpuWC", 6)} ${pad("cpuGPU", 6)} ${pad("cpuApp", 6)}  note`,
  ];
  for (const p of passes) {
    const s = p.stats;
    const note = p.error ?? (p.noEffect ? "NO EFFECT (input did not reach the editor)" : "");
    lines.push(
      `${p.drawing.replace(/\.excalidraw$/, "").padEnd(20)} ${p.input.padEnd(15)} ${pad(s.fps, 6)} ${pad(p.input === "idle" ? "-" : s.renderHz, 7)} ${pad(s.framesLe9msPct, 6)} ${pad(s.intervalP95, 6)} ${pad(s.droppedFrames, 5)} ${pad(s.inputHz, 6)} ${pad(s.inputFrameHz ?? "-", 6)} ${pad(s.multiRenderFrames, 5)} ${pad(s.scriptMsP50 ?? "-", 6)} ${pad(s.scriptMsP95 ?? "-", 6)} ${pad(s.scriptBusyPct ?? "-", 5)} ${pad(p.cpuPct?.webContent ?? "-", 6)} ${pad(p.cpuPct?.gpu ?? "-", 6)} ${pad(p.cpuPct?.app ?? "-", 6)}  ${note}`,
    );
  }
  return lines.join("\n");
}

const env = environment();
log(`macOS ${env.macOS}, power: ${env.powerSource} ${env.battery}, Low Power Mode: ${env.lowPowerMode}`);
const vault = await ensureProbeVault();
const built = o["no-build"] ? reuseBuiltApp({ wtRoot }) : await buildPerfApp({ wtRoot, log });
// Keep the display awake for the run.
try {
  spawn("caffeinate", ["-dimsu", "-t", "600", "-w", String(process.pid)], { stdio: "ignore" }).on("error", () => {});
} catch { /* best effort */ }
log("launching the app (window opens in the background) ...");
const run = await runAppOnce({
  appPath: built.appPath, pristineVault: vault, runIndex: 0, timeoutMs: 240_000,
  keepRuns: !!o["keep-runs"], memoryPressure: false, log,
  env: {
    VAULTDRAW_PERF_SUITE: o["drawing-only"] && extraScenes.length ? "refresh-rate-drawings" : "refresh-rate",
    VAULTDRAW_PERF_DRAWINGS: JSON.stringify(extraScenes.map((s) => ({ path: s.rel, pattern: s.pattern, elements: s.elements }))),
  },
  configToml: o.config ? readFileSync(o.config, "utf8") : undefined,
});
const probe = run.info?.refreshRate ?? null;
const result = {
  label: o.label ?? "",
  at: new Date().toISOString(),
  git: built.git,
  environment: env,
  config: o.config ?? null,
  drawing: o.drawing ?? null,
  display: probe?.display ?? null,
  displayHz: probe?.displayHz ?? null,
  samples: run.samples,
  errors: run.errors,
  passes: probe?.passes ?? [],
};
const out = o.out ?? path.join(cacheDir, `refresh-rate-${result.at.replace(/[:.]/g, "-")}.json`);
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 2));

const d = probe?.display ?? {};
console.log(`\nRefresh-rate probe ${result.label ? `(${result.label}) ` : ""}@ ${built.git?.sha?.slice(0, 7) ?? "?"}${built.git?.dirty ? "+dirty" : ""}`);
if (o.config) console.log(`config: ${o.config} (copied into the temp config dir)`);
console.log(`macOS ${env.macOS}; WebKit ${d.display?.webkitVersion ?? "?"}; power ${env.powerSource}; Low Power Mode ${env.lowPowerMode}`);
console.log(`screen: ${d.display?.screenName ?? "?"} max ${d.display?.screenMaxFps ?? "?"} fps; CVDisplayLink ${d.displayLink?.measuredHz ?? "?"} Hz (nominal ${d.displayLink?.nominalHz ?? "?"}); window visible=${d.display?.windowVisibleOcclusionBit} key=${d.display?.windowIsKey}`);
console.log(`60 fps cap flag: ${JSON.stringify(d.flag ?? null)}; live: near60fps enabled=${d.display?.liveNear60fpsEnabled}`);
console.log("");
console.log(table(result.passes));
if (d.window && (d.window.width < 2400 || d.window.height < 1600)) {
  console.log(`WARNING: the window is ${d.window.width}x${d.window.height} device px (a tiling window manager may have shrunk it); compare runs only at equal window sizes`);
}
console.log(`window ${JSON.stringify(d.window ?? null)}; static canvas ${result.passes.find((p) => p.canvas)?.canvas ?? "?"} device px`);
console.log(`\nfps = rendering updates/s; drawnHz = frames/s that showed a new canvas render; multi = frames that drew the scene 2+ times; inFrHz = frames/s that received input (caps drawnHz);`);
console.log(`jsP50/P95 = static-render script ms per rendering frame; js% = share of the pass in that script; cpu* = % of a core (WebContent, GPU, app processes).`);
console.log(`JSON: ${out}`);
for (const e of run.errors) log(`error: ${e}`);

const gated = result.passes.filter((p) => p.input !== "idle" && p.input.endsWith(".native") || p.input.endsWith(".native.out")).filter((p) => !p.error && !p.noEffect);
// Drawn Hz also carries the injected input's timing jitter, so its floor is lower.
const BUDGET_DRAWN_HZ = 100;
const failing = (result.displayHz ?? 0) >= 120 ? gated.filter((p) => p.stats.fps < BUDGET_FPS || p.stats.renderHz < BUDGET_DRAWN_HZ) : [];
if (failing.length) log(`${failing.length} native zoom/pan passes below ${BUDGET_FPS} fps or ${BUDGET_DRAWN_HZ} drawn Hz: ${failing.map((p) => `${p.drawing.replace(/\.excalidraw$/, "")} ${p.input}`).join(", ")}`);
process.exit(run.errors.length || failing.length || !result.passes.length ? 1 : 0);
