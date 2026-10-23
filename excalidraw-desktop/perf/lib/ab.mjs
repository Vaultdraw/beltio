// Base-vs-head A/B: interleaved single-run harness invocations, merged per side.
// Pure helpers (interleaveOrder, mergeSide, buildAbResult) are unit-tested; the rest shells out to git / run.mjs.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, readdirSync } from "node:fs";
import path from "node:path";
import { aggregate } from "./stats.mjs";

/** [{side, index}] base,head,base,head,... (pairs of each; index = per-side run number). */
export function interleaveOrder(pairs) {
  const out = [];
  for (let i = 0; i < pairs; i++) out.push({ side: "base", index: i }, { side: "head", index: i });
  return out;
}

/** Per-run result JSONs of one side -> { raw (per-run samples), metrics (aggregated), errors, perRunLoad }. */
export function mergeSide(results, unitOf = () => "") {
  const raw = results.flatMap((r) => r.raw?.browser ?? []);
  return {
    raw,
    metrics: aggregate(raw, unitOf),
    errors: results.flatMap((r) => r.errors ?? []),
    perRunLoad: results.map((r) => r.load?.start).filter(Number.isFinite),
  };
}

/** Head result in run.mjs's result format, plus the ab field. `template` is any head run result (git, machine, mode...). */
export function buildAbResult({ template, head, base, baseSha, pairs, load, notes = [] }) {
  const perRun = [...head.perRunLoad, ...base.perRunLoad];
  const fullLoad = { ...load, perRun };
  return {
    ...template,
    createdAt: new Date().toISOString(),
    config: { ...template.config, runs: head.raw.length, warmup: 0 },
    load: fullLoad,
    metrics: head.metrics,
    raw: { app: [], browser: head.raw },
    notes: [...notes, ...(template.notes ?? []).filter((n) => !n.startsWith("browser info"))],
    errors: [...head.errors, ...base.errors.map((e) => `base: ${e}`)],
    ab: { base: { sha: baseSha, metrics: base.metrics }, pairs, load: fullLoad },
  };
}

// CPU time (not wall) and event counts: these barely move with machine load, so they gate even from one pair.
export const LOAD_INSENSITIVE = /^browser\.(cpu\.(thread|process)|count\.)/;
export const CONFIRM_PAIRS = 3;

/**
 * Split compare() failures into blocking and unconfirmed. Wall-clock failures only block when they were
 * measured on a quiet machine with at least CONFIRM_PAIRS pairs; load-insensitive ones always block.
 */
export function gateFailures(failing, { quiet, pairs }) {
  const trusted = quiet && pairs >= CONFIRM_PAIRS;
  const blocking = failing.filter((r) => trusted || LOAD_INSENSITIVE.test(r.metric));
  return { blocking, unconfirmed: failing.filter((r) => !blocking.includes(r)) };
}

/** Wall-clock p95 rows: one cold or slow sample per run moves them, so they block only when a second A/B reproduces them. */
export const isWallP95 = (r) => r.stat === "p95" && !LOAD_INSENSITIVE.test(r.metric);

/**
 * Wall-clock medians that noise widening let through ("noisy-ok": worse than the 5% rule, inside the widened threshold)
 * but that moved the same way in every interleaved pair (per-run medians, pair i = base run i vs head run i).
 * Widening to 20-90% hid a consistent +20% vault.openToTree shift (2026-10-19); this catches it. Returned as
 * regressed rows with `consistent: true`; like p95 flags they must reproduce in a second A/B.
 */
export function consistentShifts(rows, headMetrics, baseMetrics, minPairs = CONFIRM_PAIRS) {
  return rows
    .filter((r) => r.status === "noisy-ok" && r.stat === "median" && !LOAD_INSENSITIVE.test(r.metric))
    .filter((r) => {
      const h = headMetrics[r.metric]?.perRunMedians ?? [];
      const b = baseMetrics[r.metric]?.perRunMedians ?? [];
      const n = Math.min(h.length, b.length);
      const dir = Math.sign(r.cur - r.base);
      return n >= minPairs && dir !== 0 && h.slice(0, n).every((x, i) => Math.sign(x - b[i]) === dir);
    })
    .map((r) => ({ ...r, status: "regressed", consistent: true, note: `${r.note}; same direction in every pair` }));
}

/** Flags a second A/B can clear: wall-clock p95s and sign-consistent medians. */
const needsRepeat = (r) => isWallP95(r) || !!r.consistent;

/** A reproduction A/B is worth running only when every blocking flag is one it can clear (anything else blocks anyway). */
export const needsReproduction = (blocking) => blocking.length > 0 && blocking.every(needsRepeat);

/** Split the first A/B's blocking flags by whether the independent second A/B flagged the same metric and stat. */
export function reproduced(blocking, repeatFailing) {
  const again = new Set(repeatFailing.map((r) => `${r.metric}.${r.stat}`));
  const hit = (r) => again.has(`${r.metric}.${r.stat}`);
  return { blocking: blocking.filter(hit), cleared: blocking.filter((r) => !hit(r)) };
}

const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8" }).trim();

/** Main checkout (owner of the shared node_modules) = parent of the repo's common git dir. */
export const mainCheckout = (wt) => path.dirname(path.resolve(wt, git(wt, "rev-parse", "--git-common-dir")));

/** Create (or reuse) a detached worktree of `ref` under <headWt>/.cache/perf/ab/base-<shortsha>. */
export function ensureBaseWorktree(headWt, ref) {
  const sha = git(headWt, "rev-parse", "--verify", `${ref}^{commit}`);
  const dir = path.join(headWt, ".cache", "perf", "ab", `base-${sha.slice(0, 10)}`);
  if (!existsSync(dir)) {
    mkdirSync(path.dirname(dir), { recursive: true });
    git(headWt, "worktree", "add", "--detach", "-f", dir, sha);
  }
  linkNodeModules(mainCheckout(headWt), dir);
  return { dir, sha };
}

/** Same set as personal/feature/new-worktree.sh. */
export function linkNodeModules(main, wt) {
  const rels = ["node_modules", "excalidraw-desktop/node_modules"];
  const pkgs = path.join(main, "packages");
  if (existsSync(pkgs)) for (const d of readdirSync(pkgs)) rels.push(`packages/${d}/node_modules`);
  for (const rel of rels) {
    const src = path.join(main, rel);
    const dst = path.join(wt, rel);
    if (existsSync(src) && !existsSync(dst)) symlinkSync(src, dst);
  }
}

/** One `run.mjs --runs 1` invocation (head's runner, pointed at `wtRoot` via PERF_WT_ROOT). */
export function runOnce({ runMjs, wtRoot, fixturesDir, out, lowEnd, build, scenarios, log }) {
  const args = [runMjs, "--skip-app", "--runs", "1", "--quiet-wait", "0", "--out", out];
  if (scenarios?.length) args.push("--scenarios", scenarios.join(","));
  if (lowEnd) args.push("--low-end");
  if (!build) args.push("--no-build");
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, args, {
      stdio: ["ignore", "ignore", "inherit"],
      env: { ...process.env, PERF_WT_ROOT: wtRoot, PERF_FIXTURES_DIR: fixturesDir },
    });
    c.on("error", reject);
    c.on("exit", (code) => {
      if (!existsSync(out)) return reject(new Error(`run.mjs exited ${code} without a result file`));
      log?.(`run exited ${code}`);
      resolve(JSON.parse(readFileSync(out, "utf8")));
    });
  });
}
