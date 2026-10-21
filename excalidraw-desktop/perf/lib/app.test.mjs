import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isRafStall, runAppOnce, vaultDirName } from "./app.mjs";

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-app.mjs");
function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "perf-test-"));
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
  const cpu = r.samples["idle.cpuPercent"][0];
  assert.ok(cpu > 20 && cpu < 90, `idle cpu ${cpu}`);
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
  const r = await runAppOnce({ appPath: "unused", binary: fake, pristineVault: vault, runsDir, timeoutMs: 1500, env: { FAKE_MODE: "hang" } });
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
