import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isRafStall, runAppOnce, vaultDirName } from "./app.mjs";

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-app.mjs");
const roots = [];
test.after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));
function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "perf-test-"));
  roots.push(root);
  const vault = path.join(root, "pristine");
  mkdirSync(vault);
  writeFileSync(path.join(vault, "a.excalidraw"), "{}");
  return { root, vault, runsDir: path.join(root, "runs") };
}

test("runAppOnce with fake binary: marks, rss, idle cpu, report merge, cleanup", async () => {
  const { vault, runsDir } = setup();
  const r = await runAppOnce({ appPath: "unused", binary: fake, pristineVault: vault, runsDir, sampleEveryMs: 100 });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.samples["open.small"], [10, 12]);
  assert.ok(r.samples["startup.coldToInteractive"][0] >= 250);
  assert.ok(r.samples["memory.peakRssMB"][0] > 5);
  // Load-independent: the percent turned back into CPU seconds must match the CPU the fake
  // itself reports between its idle marks, not a wall-clock share that drops under load.
  const pct = r.samples["idle.cpuPercent"][0];
  const cpuS = (pct / 100) * r.info.idleWindowS;
  const own = r.info.selfIdleCpuS;
  assert.ok(own >= 0.5, `fake used ${own} s`);
  // Bounds: the harness window runs from its ps sample after idle-begin to its ps sample after
  // idle-end, so it also holds the fake's idle tail (mark print, GC, helper threads: tens of ms,
  // more under load) -> up to +0.25 s. Below, it can only lose the start of the burn if the
  // idle-begin sample is over a second late -> at least half. A broken delta (zero, doubled,
  // wrong pid set) falls outside both.
  assert.ok(cpuS > own * 0.5 && cpuS < own + 0.25, `idle cpu ${cpuS} s (${pct}% of ${r.info.idleWindowS} s) vs the fake's own ${own} s`);
  assert.deepEqual(r.marks.map((m) => m.name), ["interactive", "phase:open", "idle-begin", "idle-end"]);
  assert.equal(existsSync(path.join(runsDir)), true);
  assert.equal(r.runDir, undefined);
});

test("runAppOnce reports missing smoke-report", async () => {
  const { vault, runsDir } = setup();
  const r = await runAppOnce({ appPath: "unused", binary: fake, pristineVault: vault, runsDir, env: { FAKE_MODE: "noreport" } });
  assert.ok(r.errors.some((e) => /no smoke-report/.test(e)));
});

test("runAppOnce kills on timeout", async () => {
  const { vault, runsDir } = setup();
  // The harness timer is wall-clock from spawn and the fake needs a process start plus 300 ms to
  // print its mark, so a fixed 1500 ms misses the mark when the machine is busy. Scale the budget
  // by how long a bare node start takes right now (the part load stretches).
  const t0 = performance.now();
  spawnSync(process.execPath, ["-e", "0"]);
  const nodeStartMs = performance.now() - t0;
  const timeoutMs = Math.round(1500 + nodeStartMs * 20);
  const r = await runAppOnce({ appPath: "unused", binary: fake, pristineVault: vault, runsDir, timeoutMs, env: { FAKE_MODE: "hang" } });
  assert.ok(r.errors.some((e) => /timeout/.test(e)));
  assert.equal(r.samples["startup.coldToInteractive"]?.length, 1);
});

test("vaultDirName encodes the opt-in modes; the default stays 'vault'", () => {
  assert.equal(vaultDirName(), "vault");
  assert.equal(vaultDirName({}), "vault");
  assert.equal(vaultDirName({ leak: true }), "vault+leak");
  assert.equal(vaultDirName({ typical: true }), "vault+typical");
  assert.equal(vaultDirName({ leak: true, leakOnly: true }), "vault+leakonly");
  assert.equal(vaultDirName({ leak: true, typical: true }), "vault+leak+typical");
  assert.equal(vaultDirName({ typical: true, ablate: true }), "vault+typical+ablate");
});

test("runAppOnce in leak mode: marks become checkpoints; mode travels in the vault folder name", async () => {
  const { vault, runsDir } = setup();
  const r = await runAppOnce({
    appPath: "unused", binary: fake, pristineVault: vault, runsDir, sampleEveryMs: 100, keepRuns: true,
    modes: { leak: true }, altVault: vault, env: { FAKE_MODE: "leak" },
  });
  assert.ok(r.runDir && path.basename(r.runDir.length ? path.join(r.runDir, "vault+leak") : "") === "vault+leak");
  assert.ok(existsSync(path.join(r.runDir, "vault+leak")) && existsSync(path.join(r.runDir, "vault-alt")));
  // The fake app is not a WebKit app: the footprint of its pid is read like any other process.
  const labels = (r.info.leakCheckpoints ?? []).map((c) => c.label);
  assert.deepEqual(labels, ["baseline", "after-10", "after-vault-switch", "idle-after"]);
  assert.ok(r.samples["memory.leak.growthMB"].length === 1);
  assert.ok(r.notes.some((n) => /leak checkpoints/.test(n)));
});

test("isRafStall: only a stalled-frame error marks a run as hidden-window", () => {
  assert.equal(isRafStall(["in-app: save: rAF stalled (window hidden/occluded?)"]), true);
  assert.equal(isRafStall(["Tree row not found: perf-small.excalidraw"]), false);
  assert.equal(isRafStall([]), false);
  assert.equal(isRafStall(), false);
});
