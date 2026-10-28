// Simultaneous whole-app peak: the largest SUM of per-process phys_footprint seen in one sample,
// as opposed to memory.peakFootprintMB (sum of each process's own lifetime peak, an upper bound
// because the peaks happen at different moments). Used by `perf/run.mjs --owner-typical`.
const MB = 1024 * 1024;
const r1 = (n) => Math.round(n * 10) / 10;

/**
 * Feed it footprint samples (Map<pid, {footprint}>) as they arrive; it keeps the best sum
 * overall and per label (the perf phase that was running), plus each process's own maximum.
 */
export function createPeakTracker(roleOf = (pid) => `pid${pid}`) {
  let best = null; // { total, label, tMs, procs }
  const byLabel = new Map(); // label -> total MB
  const roleMax = new Map(); // role -> MB
  let samples = 0;
  return {
    add(map, label = "start", tMs = 0) {
      if (!map || !map.size) return;
      samples++;
      const procs = {};
      let total = 0;
      for (const [pid, v] of map) {
        if (!Number.isFinite(v.footprint)) continue;
        const role = roleOf(pid);
        const mb = v.footprint / MB;
        procs[role] = r1(mb);
        total += mb;
        if (mb > (roleMax.get(role) ?? 0)) roleMax.set(role, mb);
      }
      if (!best || total > best.total) best = { total, label, tMs, procs };
      if (total > (byLabel.get(label) ?? 0)) byLabel.set(label, total);
    },
    summary() {
      return {
        samples,
        peakMB: best ? r1(best.total) : null,
        peakLabel: best?.label ?? null,
        peakProcs: best?.procs ?? {},
        perLabelMB: Object.fromEntries([...byLabel].map(([k, v]) => [k, r1(v)])),
        perRoleMaxMB: Object.fromEntries([...roleMax].map(([k, v]) => [k, r1(v)])),
      };
    },
  };
}

/** Plain-words note for the result file. */
export function peakNote(s) {
  if (!s.samples || s.peakMB == null) return "simultaneous peak: no footprint samples";
  const procs = Object.entries(s.peakProcs).map(([k, v]) => `${k} ${v}`).join(", ");
  const phases = Object.entries(s.perLabelMB).map(([k, v]) => `${k.replace(/^phase:/, "")} ${v}`).join(" | ");
  return `simultaneous whole-app peak ${s.peakMB} MB at "${s.peakLabel}" (${procs}) over ${s.samples} samples; max per phase (MB): ${phases}`;
}
