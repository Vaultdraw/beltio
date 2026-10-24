// Gate: compare a result against a baseline using the catalogue rules.
import { specFor, orderIndex } from "./catalogue.mjs";

/**
 * Baseline may be a single result or a combined file { machine, commit, modes: { normal, "low-end" } }.
 * Returns { baseline, warnings } (baseline null when the mode is absent).
 */
export function pickBaseline(file, mode, currentMachine) {
  const warnings = [];
  let baseline;
  let machine;
  if (file?.modes) {
    baseline = file.modes[mode] ?? null;
    machine = file.machine ?? baseline?.machine;
    if (!baseline) warnings.push(`baseline has no "${mode}" mode; everything is treated as new`);
  } else {
    baseline = file ?? null;
    machine = file?.machine;
    if (baseline && baseline.mode && baseline.mode !== mode) {
      warnings.push(`baseline mode is "${baseline.mode}" but this run is "${mode}"`);
    }
  }
  if (machine && currentMachine && (machine.brand !== currentMachine.brand || machine.memBytes !== currentMachine.memBytes)) {
    warnings.push(`baseline machine differs (${machine.brand}, ${machine.memGB ?? "?"} GB vs ${currentMachine.brand}, ${currentMachine.memGB ?? "?"} GB); numbers are not comparable`);
  }
  return { baseline, warnings };
}

const pctDelta = (cur, base) => (base === 0 ? (cur === 0 ? 0 : Infinity) : ((cur - base) / Math.abs(base)) * 100);

/**
 * Rows: { metric, stat, unit, base, cur, deltaPct, threshold (percent), noisy, status, note }
 * status: ok | regressed | improved | budget | budget-preexisting | budget-warn | noisy-ok | new | missing
 *
 * Regression: cur > base*(1+thr) AND cur-base > absolute slack (mirrored for `better: "higher"` metrics). thr = 5% (spec.pct) or, when either side is noisy
 * (CV > 5%), max(thr, 2*max(cvBase, cvCur)).
 *
 * Budget policy (a deliberate decision): a budget breach FAILS only when the baseline met the budget (or there is no
 * baseline value). If the baseline already breached it, it is reported loudly as "budget-preexisting" but does not
 * fail, otherwise a single historic miss would block every merge of the whole team.
 */
export function compare(current, baseline, catalogue, mode = current?.mode) {
  const rows = [];
  const cm = current?.metrics ?? {};
  const bm = baseline?.metrics ?? {};
  const ids = [...new Set([...Object.keys(cm), ...Object.keys(bm)])].sort(
    (a, b) => orderIndex(catalogue, a) - orderIndex(catalogue, b) || a.localeCompare(b),
  );
  for (const id of ids) {
    const spec = specFor(catalogue, id, mode);
    if (!spec) continue;
    const c = cm[id];
    const b = bm[id];
    if (!c) {
      for (const stat of spec.gate) rows.push({ metric: id, stat, unit: spec.unit, base: b?.[stat], cur: undefined, status: "missing" });
      continue;
    }
    for (const stat of spec.gate) {
      const cur = c[stat];
      if (!b || b[stat] === undefined) {
        rows.push({ metric: id, stat, unit: spec.unit, base: undefined, cur, status: "new" });
        continue;
      }
      const base = b[stat];
      const noisy = !!(c.noisy || b.noisy);
      let thr = spec.pct / 100;
      let widened = false;
      if (noisy && spec.noiseWidening) {
        const w = 2 * Math.max(b.cv ?? 0, c.cv ?? 0);
        if (w > thr) {
          thr = w;
          widened = true;
        }
      }
      // `worse` > 0 means the metric moved in its bad direction.
      const sign = spec.better === "higher" ? -1 : 1;
      const worse = sign * (cur - base);
      const worseBy = (t) => worse > Math.abs(base) * t && worse > spec.slack;
      let status = "ok";
      if (worseBy(thr)) status = "regressed";
      else if (widened && worseBy(spec.pct / 100)) status = "noisy-ok";
      else if (-worse > Math.abs(base) * thr && -worse > spec.slack) status = "improved";
      rows.push({
        metric: id, stat, unit: spec.unit, base, cur,
        deltaPct: pctDelta(cur, base), threshold: thr * 100, noisy, status,
        note: widened ? `noisy: threshold widened to ${(thr * 100).toFixed(1)}%` : noisy ? "noisy" : "",
      });
    }
    for (const bud of spec.budgets) {
      // { max }: value must be < max; { min }: value must be >= min.
      const meets = (v) => (bud.min !== undefined ? v >= bud.min : v < bud.max);
      const cur = c[bud.stat];
      if (cur === undefined || meets(cur)) continue;
      const baseVal = b?.[bud.stat];
      const baseMet = baseVal === undefined || meets(baseVal);
      rows.push({
        metric: id, stat: bud.stat, unit: spec.unit, base: baseVal, cur,
        deltaPct: baseVal === undefined ? undefined : pctDelta(cur, baseVal),
        threshold: undefined, noisy: false,
        status: bud.warn ? "budget-warn" : baseMet ? "budget" : "budget-preexisting",
        note: `budget ${bud.min !== undefined ? `>= ${bud.min}` : `< ${bud.max}`} ${spec.unit}${bud.warn ? " (warning only)" : baseMet ? "" : " (baseline already breached it; warning only)"}`,
      });
    }
  }
  const failing = rows.filter((r) => r.status === "regressed" || r.status === "budget");
  return { rows, exitCode: failing.length ? 1 : 0, failing };
}
