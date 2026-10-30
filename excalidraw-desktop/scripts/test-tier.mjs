#!/usr/bin/env node
// Tiered test runner. Run from anywhere in the repo:
//   node excalidraw-desktop/scripts/test-tier.mjs fast       # affected only: seconds to ~1 min
//   node excalidraw-desktop/scripts/test-tier.mjs merge      # full functional suite + quick perf A/B vs base
//   node excalidraw-desktop/scripts/test-tier.mjs milestone  # the heavy set (both engines, full perf, low-end)
// Options: --base <ref> (default: merge-base with main), --dry-run (print the plan), --no-e2e, --no-perf.
// Locks: functional steps take no lock (e2e gets its own port). Only perf steps take build.lock.
// Wrap merge/milestone in personal/metrics/heavy.sh (heavy.sh -> build.lock order is kept).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { impactedSpecs, listSpecNames, specsLoadingPlugin } from "./e2e-impact.mjs";
import { lintableFiles } from "./lint-files.mjs";
import { exitOnSignals, runGuarded } from "./run-guarded.mjs";

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: "string" },
    "dry-run": { type: "boolean" },
    "no-e2e": { type: "boolean" },
    "no-perf": { type: "boolean" },
  },
});
const tier = positionals[0];
if (!["fast", "merge", "milestone"].includes(tier)) {
  console.error(
    "usage: test-tier.mjs fast|merge|milestone [--base <ref>] [--dry-run] [--no-e2e] [--no-perf]",
  );
  process.exit(2);
}

const desktop = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const root = path.resolve(desktop, "..");
const git = (...a) =>
  execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
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
  return [...new Set(lines.split("\n").filter(Boolean))]
    .filter((f) => existsSync(path.join(root, f)))
    .sort();
}

const steps = [];
const step = (name, cwd, cmd, args, env = {}, extra = {}) =>
  steps.push({ name, cwd, cmd, args, env, ...extra });
const npx = (cwd, name, args, env) => step(name, cwd, "npx", args, env);
// Playwright gets a hard deadline and a progress file (toimprove 104: runs printed every test as
// passed and then never exited). E2E_DEADLINE_MIN overrides the deadline.
const DEADLINE_MIN = { fast: 30, merge: 60, milestone: 150 };
const playwright = (name, args, env = {}) =>
  step(name, desktop, "npx", ["playwright", "test", ...args], env, {
    deadlineMs:
      (Number(process.env.E2E_DEADLINE_MIN) || DEADLINE_MIN[tier]) * 60_000,
    progress: true,
  });
const perf = (name, args) =>
  step(name, root, "lockf", [
    "-k",
    LOCK,
    "node",
    "excalidraw-desktop/perf/" + args[0],
    ...args.slice(1),
  ]);
const tscIncremental = (p, info) => [
  "tsc",
  "--noEmit",
  "--incremental",
  "--tsBuildInfoFile",
  path.join(root, ".cache/tsc", info),
  "-p",
  p,
];
const eslint = (files) => [
  "eslint",
  "--max-warnings=0",
  "--cache",
  "--cache-location",
  ".cache/eslint/",
  ...files,
];

if (tier === "fast") {
  const files = changedFiles();
  const inDesktop = (f) =>
    f.startsWith("excalidraw-desktop/") &&
    !f.startsWith("excalidraw-desktop/src-tauri/");
  const code = files.filter((f) => /\.(m?js|tsx?)$/.test(f));
  const desktopSrc = code.filter((f) =>
    f.startsWith("excalidraw-desktop/src/"),
  );
  const pkgSrc = code.filter((f) => f.startsWith("packages/"));
  console.log(`base ${base.slice(0, 10)}; ${files.length} changed file(s)`);
  if (code.some(inDesktop) || pkgSrc.length)
    npx(
      desktop,
      "tsc (desktop, incremental)",
      tscIncremental("tsconfig.json", "desktop.tsbuildinfo"),
    );
  // plugins/ and sdk/ are type-checked only by the root config (two merges on
  // 2026-10-29 broke it unseen when this ran for packages/ alone).
  const rootOnly = code.filter((f) => /^(packages|plugins|sdk)\//.test(f));
  if (rootOnly.length)
    npx(
      root,
      "tsc (root, incremental)",
      tscIncremental("tsconfig.json", "root.tsbuildinfo"),
    );
  // Plugin SDK (sdk/) is .mjs too; desktop .mjs stays out of the fast tier (not lint-clean on main yet).
  const candidates = code.filter(
    (f) =>
      (/\.(js|tsx?)$/.test(f) || f.startsWith("sdk/")) &&
      !f.startsWith("excalidraw-desktop/src-tauri/"),
  );
  const lintable = await lintableFiles(candidates, root); // ESLint-ignored files (generated .d.ts) never reach eslint
  if (lintable.length)
    npx(root, `eslint (${lintable.length} changed)`, eslint(lintable));
  // vitest related: the changed files plus every test that imports them (module graph).
  const rel = (fs) => fs.map((f) => path.join(root, f));
  if (desktopSrc.length || pkgSrc.length) {
    npx(desktop, "vitest related (desktop)", [
      "vitest",
      "related",
      "--run",
      "--passWithNoTests",
      ...rel([...desktopSrc, ...pkgSrc]),
    ]);
  }
  // Plugin SDK and official plugins are tested under the root config (run from the root, not the plugin folder).
  const sdkPlugins = code.filter(
    (f) => f.startsWith("sdk/") || f.startsWith("plugins/official/"),
  );
  if (sdkPlugins.length)
    npx(root, "vitest related (sdk, official plugins)", [
      "vitest",
      "related",
      "--run",
      "--passWithNoTests",
      ...rel(sdkPlugins),
    ]);
  if (pkgSrc.length)
    npx(root, "vitest related (packages)", [
      "vitest",
      "related",
      "--run",
      "--passWithNoTests",
      ...rel(pkgSrc),
    ]);
  // Tests that read plugin manifests from disk are invisible to `vitest related`
  // (a plugin.toml change slipped past the startup stub table on 2026-10-30).
  if (files.some((f) => /^plugins\/official\/[^/]+\/plugin\.toml$/.test(f))) {
    npx(desktop, "vitest (official plugin manifests)", [
      "vitest",
      "run",
      "src/plugins/officialPlugins.test.ts",
      "src/plugins/officialResolve.test.ts",
    ]);
  }
  if (code.some((f) => f.startsWith("excalidraw-desktop/perf/")))
    step("perf lib tests", root, "node", [
      "--test",
      "excalidraw-desktop/perf/lib/*.test.mjs",
    ]);
  if (code.some((f) => f.startsWith("excalidraw-desktop/scripts/")))
    step("script tests", root, "node", [
      "--test",
      "excalidraw-desktop/scripts/*.test.mjs",
    ]);
  if (files.some((f) => f.startsWith("excalidraw-desktop/src-tauri/"))) {
    step("cargo test", path.join(desktop, "src-tauri"), "cargo", [
      "test",
      "--quiet",
    ]);
  }
  if (!o["no-e2e"]) {
    const { specs, reasons } = impactedSpecs(
      files,
      listSpecNames(path.join(desktop, "e2e")),
      (id) => specsLoadingPlugin(path.join(desktop, "e2e"), id),
    );
    // The UI crawler (testing.md "Crawler first") runs whenever app UI code or styles changed: ~2 min, light + dark.
    const uiChanged = files.some(
      (f) =>
        /^(excalidraw-desktop\/src\/|packages\/).*\.(tsx?|css)$/.test(f) &&
        !/\.test\.tsx?$/.test(f),
    );
    if (
      uiChanged ||
      files.some(
        (f) =>
          f.startsWith("excalidraw-desktop/e2e/families/crawl") ||
          f === "excalidraw-desktop/e2e/fixture.ts",
      )
    ) {
      if (!specs.includes("families/crawl")) {
        specs.push("families/crawl");
        reasons["families/crawl"] = "UI code changed: crawl every control";
      }
    }
    for (const s of specs) console.log(`  e2e ${s} <- ${reasons[s]}`);
    if (specs.length)
      playwright(
        `playwright (${specs.length} spec(s), webkit)`,
        specs.map((s) => `e2e/${s}.spec.ts`),
      );
  }
} else {
  // Load caps (personal/feature/README.md "Load caps"): full suites must not flood the machine while
  // other teams and the user's app run. vitest 3.0.6 refuses --maxWorkers without --minWorkers.
  // E2E_WORKERS from the caller's env wins (e.g. 4 when this is the only heavy job).
  const vitestCaps = ["--maxWorkers=4", "--minWorkers=1"];
  const e2eEnv = { E2E_WORKERS: process.env.E2E_WORKERS || "2" };
  npx(
    desktop,
    "tsc (desktop)",
    tscIncremental("tsconfig.json", "desktop.tsbuildinfo"),
  );
  npx(
    root,
    "eslint (desktop)",
    eslint(["--ext", ".js,.ts,.tsx", "excalidraw-desktop"]),
  );
  // Plugin SDK and example plugins (sdk/) are linted when the folder exists; the CLI is .mjs, so include it.
  if (existsSync(path.join(root, "sdk")))
    npx(
      root,
      "eslint (sdk)",
      eslint(["--ext", ".js,.ts,.tsx,.mjs,.cjs", "sdk"]),
    );
  npx(desktop, "vitest (desktop)", ["vitest", "run", ...vitestCaps]);
  // Example plugins (sdk/examples) are the plugin host's integration tests.
  npx(root, "vitest (sdk examples)", ["vitest", "run", "sdk", ...vitestCaps]);
  npx(
    root,
    "vitest (sdk examples, mock host)",
    ["vitest", "run", "sdk/examples", ...vitestCaps],
    { VAULTDRAW_TEST_HOST: "mock" },
  );
  step("perf lib tests", root, "node", [
    "--test",
    "excalidraw-desktop/perf/lib/*.test.mjs",
    "excalidraw-desktop/scripts/*.test.mjs",
  ]);
  // The editor packages' own tests (sticky notes, stats, toolbar, ...). Before 2026-10-28 only the
  // milestone tier ran them, so a toolbar change broke 15 sticky-note tests unseen.
  npx(root, "vitest (packages)", ["vitest", "run", "packages", ...vitestCaps]);
  if (tier === "milestone") {
    npx(root, "tsc (root)", ["tsc"]);
    npx(root, "vitest (root)", ["vitest", "run", ...vitestCaps]);
  }
  if (!o["no-e2e"]) {
    playwright(
      `playwright (${
        tier === "milestone" ? "full, webkit + chromium" : "functional, webkit"
      })`,
      [],
      tier === "milestone" ? { ...e2eEnv, E2E_FULL: "1" } : e2eEnv,
    );
  }
  if (!o["no-perf"]) {
    if (tier === "merge") {
      // Quick perf: one interleaved base/head pair (headless Chromium, normal profile). The CPU-time and
      // count metrics carry the signal under load; a flagged regression is confirmed with --pairs 3.
      perf("perf A/B vs base (1 pair)", [
        "ab.mjs",
        "--base",
        base,
        "--quiet-wait",
        "60",
      ]);
    } else {
      perf("perf milestone (normal)", ["run.mjs", "--milestone"]);
      perf("perf milestone (low-end)", ["run.mjs", "--milestone", "--low-end"]);
    }
  }
}

const fmt = (ms) =>
  ms >= 60_000
    ? `${(ms / 60_000).toFixed(1)} min`
    : `${(ms / 1000).toFixed(1)} s`;
const load = () =>
  execFileSync("sysctl", ["-n", "vm.loadavg"], { encoding: "utf8" }).trim();
if (!steps.length) console.log("nothing to test");
const results = [];
const t0 = Date.now();
// Every step runs in its own process group that dies with this runner, even on SIGKILL
// (run-guarded.mjs). On a catchable signal, stop the step's group first, then exit.
exitOnSignals();
const progressDir = path.join(root, ".cache/test-tier");
for (const s of steps) {
  const env = Object.entries(s.env)
    .map(([k, v]) => `${k}=${v} `)
    .join("");
  console.log(
    `\n== ${s.name}: ${env}${s.cmd} ${s.args.join(" ")}`.slice(0, 400),
  );
  if (o["dry-run"]) continue;
  const t = Date.now();
  let progressFile;
  if (s.progress) {
    mkdirSync(progressDir, { recursive: true });
    progressFile = path.join(progressDir, `progress-${process.pid}.json`);
    rmSync(progressFile, { force: true });
  }
  const r = await runGuarded({
    cmd: s.cmd,
    args: s.args,
    cwd: s.cwd,
    deadlineMs: s.deadlineMs,
    progressFile,
    env: {
      ...process.env,
      ...s.env,
      ...(progressFile ? { E2E_PROGRESS_FILE: progressFile } : {}),
    },
  });
  if (progressFile) rmSync(progressFile, { force: true });
  if (r.note) console.log(`\n${s.name}: ${r.note}`);
  results.push({ name: s.name, ok: r.ok, ms: Date.now() - t });
  if (!r.ok) break; // fail fast: the cheapest failing signal first
}
console.log(`\n${tier} tier (load ${load()}):`);
for (const r of results)
  console.log(`  ${r.ok ? "ok  " : "FAIL"} ${r.name.padEnd(42)} ${fmt(r.ms)}`);
console.log(`  total ${fmt(Date.now() - t0)}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
