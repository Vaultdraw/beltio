#!/usr/bin/env node
// Tiered test runner. Run from anywhere in the repo:
//   node excalidraw-desktop/scripts/test-tier.mjs fast       # affected only: seconds to ~1 min
//   node excalidraw-desktop/scripts/test-tier.mjs merge      # full functional suite + quick perf A/B vs base
//   node excalidraw-desktop/scripts/test-tier.mjs milestone  # the heavy set (both engines, full perf, low-end)
// Options: --base <ref> (default: merge-base with main), --dry-run (print the plan), --no-e2e, --no-perf.
// Locks: functional steps take no lock (e2e gets its own port). Only perf steps take build.lock.
// Wrap merge/milestone in personal/metrics/heavy.sh (heavy.sh -> build.lock order is kept).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { impactedSpecs, listSpecNames } from "./e2e-impact.mjs";

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: "string" }, "dry-run": { type: "boolean" }, "no-e2e": { type: "boolean" }, "no-perf": { type: "boolean" },
  },
});
const tier = positionals[0];
if (!["fast", "merge", "milestone"].includes(tier)) {
  console.error("usage: test-tier.mjs fast|merge|milestone [--base <ref>] [--dry-run] [--no-e2e] [--no-perf]");
  process.exit(2);
}

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(desktop, "..");
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
// One lock shared by every worktree: it lives in the main checkout (parent of git's common dir).
const LOCK = path.join(
  path.dirname(git("rev-parse", "--path-format=absolute", "--git-common-dir")),
  ".cache/build.lock",
);
const base = o.base ?? git("merge-base", "HEAD", "main");

// Committed on the branch + staged + unstaged + untracked, repo-relative, existing files only.
function changedFiles() {
  const lines = [
    git("diff", "--name-only", `${base}...HEAD`),
    git("diff", "--name-only", "HEAD"),
    git("ls-files", "--others", "--exclude-standard"),
  ].join("\n");
  return [...new Set(lines.split("\n").filter(Boolean))].filter((f) => existsSync(path.join(root, f))).sort();
}

const steps = [];
const step = (name, cwd, cmd, args, env = {}) => steps.push({ name, cwd, cmd, args, env });
const npx = (cwd, name, args, env) => step(name, cwd, "npx", args, env);
const perf = (name, args) => step(name, root, "lockf", ["-k", LOCK, "node", "excalidraw-desktop/perf/" + args[0], ...args.slice(1)]);
const tscIncremental = (p, info) => ["tsc", "--noEmit", "--incremental", "--tsBuildInfoFile", path.join(root, ".cache/tsc", info), "-p", p];
const eslint = (files) => ["eslint", "--max-warnings=0", "--cache", "--cache-location", ".cache/eslint/", ...files];

if (tier === "fast") {
  const files = changedFiles();
  const inDesktop = (f) => f.startsWith("excalidraw-desktop/") && !f.startsWith("excalidraw-desktop/src-tauri/");
  const code = files.filter((f) => /\.(m?js|tsx?)$/.test(f));
  const desktopSrc = code.filter((f) => f.startsWith("excalidraw-desktop/src/"));
  const pkgSrc = code.filter((f) => f.startsWith("packages/"));
  console.log(`base ${base.slice(0, 10)}; ${files.length} changed file(s)`);
  if (code.some(inDesktop) || pkgSrc.length) npx(desktop, "tsc (desktop, incremental)", tscIncremental("tsconfig.json", "desktop.tsbuildinfo"));
  if (pkgSrc.length) npx(root, "tsc (root, incremental)", tscIncremental("tsconfig.json", "root.tsbuildinfo"));
  const lintable = code.filter((f) => /\.(js|tsx?)$/.test(f) && !f.startsWith("excalidraw-desktop/src-tauri/"));
  if (lintable.length) npx(root, `eslint (${lintable.length} changed)`, eslint(lintable));
  // vitest related: the changed files plus every test that imports them (module graph).
  const rel = (fs) => fs.map((f) => path.join(root, f));
  if (desktopSrc.length || pkgSrc.length) {
    npx(desktop, "vitest related (desktop)", ["vitest", "related", "--run", "--passWithNoTests", ...rel([...desktopSrc, ...pkgSrc])]);
  }
  if (pkgSrc.length) npx(root, "vitest related (packages)", ["vitest", "related", "--run", "--passWithNoTests", ...rel(pkgSrc)]);
  if (code.some((f) => f.startsWith("excalidraw-desktop/perf/"))) step("perf lib tests", root, "node", ["--test", "excalidraw-desktop/perf/lib/*.test.mjs"]);
  if (code.some((f) => f.startsWith("excalidraw-desktop/scripts/"))) step("script tests", root, "node", ["--test", "excalidraw-desktop/scripts/*.test.mjs"]);
  if (files.some((f) => f.startsWith("excalidraw-desktop/src-tauri/"))) {
    step("cargo test", path.join(desktop, "src-tauri"), "cargo", ["test", "--quiet"]);
  }
  if (!o["no-e2e"]) {
    const { specs, reasons } = impactedSpecs(files, listSpecNames(path.join(desktop, "e2e")));
    for (const s of specs) console.log(`  e2e ${s} <- ${reasons[s]}`);
    if (specs.length) npx(desktop, `playwright (${specs.length} spec(s), webkit)`, ["playwright", "test", ...specs.map((s) => `e2e/${s}.spec.ts`)]);
  }
} else {
  // Load caps (personal/feature/README.md "Load caps"): full suites must not flood the machine while
  // other teams and the user's app run. vitest 3.0.6 refuses --maxWorkers without --minWorkers.
  // E2E_WORKERS from the caller's env wins (e.g. 4 when this is the only heavy job).
  const vitestCaps = ["--maxWorkers=4", "--minWorkers=1"];
  const e2eEnv = { E2E_WORKERS: process.env.E2E_WORKERS || "2" };
  npx(desktop, "tsc (desktop)", tscIncremental("tsconfig.json", "desktop.tsbuildinfo"));
  npx(root, "eslint (desktop)", eslint(["--ext", ".js,.ts,.tsx", "excalidraw-desktop"]));
  npx(desktop, "vitest (desktop)", ["vitest", "run", ...vitestCaps]);
  step("perf lib tests", root, "node", ["--test", "excalidraw-desktop/perf/lib/*.test.mjs", "excalidraw-desktop/scripts/*.test.mjs"]);
  if (tier === "milestone") {
    npx(root, "tsc (root)", ["tsc"]);
    npx(root, "vitest (root)", ["vitest", "run", ...vitestCaps]);
  }
  if (!o["no-e2e"]) {
    npx(desktop, `playwright (${tier === "milestone" ? "full, webkit + chromium" : "functional, webkit"})`, ["playwright", "test"],
      tier === "milestone" ? { ...e2eEnv, E2E_FULL: "1" } : e2eEnv);
  }
  if (!o["no-perf"]) {
    if (tier === "merge") {
      // Quick perf: one interleaved base/head pair (headless Chromium, normal profile). The CPU-time and
      // count metrics carry the signal under load; a flagged regression is confirmed with --pairs 3.
      perf("perf A/B vs base (1 pair)", ["ab.mjs", "--base", base, "--quiet-wait", "60"]);
    } else {
      perf("perf milestone (normal)", ["run.mjs", "--milestone"]);
      perf("perf milestone (low-end)", ["run.mjs", "--milestone", "--low-end"]);
    }
  }
}

const fmt = (ms) => (ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} min` : `${(ms / 1000).toFixed(1)} s`);
const load = () => execFileSync("sysctl", ["-n", "vm.loadavg"], { encoding: "utf8" }).trim();
if (!steps.length) console.log("nothing to test");
const results = [];
const t0 = Date.now();
for (const s of steps) {
  const env = Object.entries(s.env).map(([k, v]) => `${k}=${v} `).join("");
  console.log(`\n== ${s.name}: ${env}${s.cmd} ${s.args.join(" ")}`.slice(0, 400));
  if (o["dry-run"]) continue;
  const t = Date.now();
  const r = spawnSync(s.cmd, s.args, { cwd: s.cwd, stdio: "inherit", env: { ...process.env, ...s.env } });
  results.push({ name: s.name, ok: r.status === 0, ms: Date.now() - t });
  if (r.status !== 0) break; // fail fast: the cheapest failing signal first
}
console.log(`\n${tier} tier (load ${load()}):`);
for (const r of results) console.log(`  ${r.ok ? "ok  " : "FAIL"} ${r.name.padEnd(42)} ${fmt(r.ms)}`);
console.log(`  total ${fmt(Date.now() - t0)}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
