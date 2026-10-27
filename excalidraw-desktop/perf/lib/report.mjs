// Human / markdown tables, machine info, baseline merge.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { specFor, orderIndex } from "./catalogue.mjs";
import { isLinux, machineInfoLinux } from "./linux.mjs";

const sysctl = (k) => { try { return execFileSync("sysctl", ["-n", k], { encoding: "utf8" }).trim(); } catch { return ""; } };

export function machineInfo() {
  if (isLinux) return machineInfoLinux();
  const memBytes = Number(sysctl("hw.memsize")) || 0;
  let os = "";
  try { os = execFileSync("sw_vers", [], { encoding: "utf8" }).trim().split("\n").map((l) => l.split(":").pop().trim()).join(" "); } catch { /* ignore */ }
  let screenLocked = false;
  try {
    screenLocked = /CGSSessionScreenIsLocked<\/key>\s*<true\/>/.test(execFileSync("ioreg", ["-n", "Root", "-d1", "-a"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }));
  } catch { /* ignore */ }
  return {
    screenLocked,
    brand: sysctl("machdep.cpu.brand_string"),
    memBytes,
    memGB: Math.round(memBytes / 2 ** 30),
    os,
    perfCores: Number(sysctl("hw.perflevel0.logicalcpu")) || 0,
    efficiencyCores: Number(sysctl("hw.perflevel1.logicalcpu")) || 0,
  };
}

export function fmt(x, unit) {
  if (x === undefined || x === null || Number.isNaN(x)) return "-";
  if (!Number.isFinite(x)) return "inf";
  const d = Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2;
  return x.toFixed(unit === "count" ? (Number.isInteger(x) ? 0 : 1) : d);
}

function budgetText(spec) {
  return spec.budgets.map((b) => `${b.stat} < ${b.max}`).join(", ");
}

function metricRows(result, catalogue) {
  const ids = Object.keys(result.metrics ?? {}).sort((a, b) => orderIndex(catalogue, a) - orderIndex(catalogue, b) || a.localeCompare(b));
  return ids.map((id) => {
    const m = result.metrics[id];
    const spec = specFor(catalogue, id, result.mode);
    const showMax = !!spec?.report.includes("max");
    return [id, m.unit || spec?.unit || "", fmt(m.median, m.unit), fmt(m.p95, m.unit), showMax ? fmt(m.max, m.unit) : "", `${((m.cv ?? 0) * 100).toFixed(1)}`, m.noisy ? "NOISY" : "", spec ? budgetText(spec) : ""];
  });
}
const HEAD = ["metric", "unit", "median", "p95", "max", "cv%", "noisy", "budget"];

function fixed(head, rows) {
  const all = [head, ...rows];
  const w = head.map((_, i) => Math.max(...all.map((r) => String(r[i]).length)));
  const line = (r) => r.map((c, i) => (i >= 2 && i <= 5 ? String(c).padStart(w[i]) : String(c).padEnd(w[i]))).join("  ").trimEnd();
  return [line(head), w.map((n) => "-".repeat(n)).join("  "), ...rows.map(line)].join("\n");
}

export function resultTable(result, catalogue) {
  return fixed(HEAD, metricRows(result, catalogue));
}

const mdTable = (head, rows) => [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

export function resultMarkdown(result, catalogue) {
  return mdTable(HEAD, metricRows(result, catalogue));
}

const CMP_HEAD = ["metric", "stat", "base", "cur", "delta%", "thr%", "status", "note"];
function cmpRows(rows) {
  return rows.map((r) => [
    r.metric, r.stat, fmt(r.base, r.unit), fmt(r.cur, r.unit),
    r.deltaPct === undefined ? "-" : (Number.isFinite(r.deltaPct) ? (r.deltaPct >= 0 ? "+" : "") + r.deltaPct.toFixed(1) : "inf"),
    r.threshold === undefined ? "-" : r.threshold.toFixed(1),
    r.status.toUpperCase() === "OK" ? "ok" : r.status === "regressed" || r.status === "budget" ? `** ${r.status.toUpperCase()} **` : r.status === "budget-preexisting" || r.status === "budget-warn" ? `WARN ${r.status}` : r.status,
    r.note ?? "",
  ]);
}
export function comparisonTable(rows) {
  return rows.length ? fixed(CMP_HEAD, cmpRows(rows)) : "(nothing to compare)";
}

export function machineLines(m) {
  return [`${m.brand}, ${m.memGB} GB RAM, ${m.perfCores}P + ${m.efficiencyCores}E cores`, m.platform === "linux" ? `${m.os}` : `macOS ${m.os}`];
}

export function baselineMarkdown(combined, catalogue) {
  const out = ["# Perf baseline", ""];
  out.push(...machineLines(combined.machine ?? {}).map((l) => `- ${l}`));
  if (combined.commit) out.push(`- commit ${combined.commit.sha?.slice(0, 10)}${combined.commit.dirty ? " (dirty)" : ""}`);
  for (const [mode, r] of Object.entries(combined.modes ?? {})) {
    out.push("", `## ${mode}`, "", `${r.createdAt} - runs ${r.config?.runs}, warmup ${r.config?.warmup}, ${r.config?.drawingCount} drawings`, "", resultMarkdown(r, catalogue));
    if (r.notes?.length) out.push("", ...r.notes.map((n) => `- ${n}`));
  }
  return out.join("\n") + "\n";
}

/** Merge result into combined[modes][result.mode] (file created if absent) and write a sibling .md. */
export function updateBaseline(file, result, catalogue) {
  let combined = { machine: result.machine, commit: result.git, modes: {} };
  if (existsSync(file)) {
    try {
      const prev = JSON.parse(readFileSync(file, "utf8"));
      if (prev.modes) combined = prev;
    } catch { /* overwrite unreadable file */ }
  }
  combined.machine = result.machine;
  combined.commit = result.git;
  // Merge per metric, so an app-only or Chromium-only refresh keeps the other half of the mode.
  const prev = combined.modes[result.mode];
  combined.modes[result.mode] = prev
    ? {
        ...result,
        metrics: { ...prev.metrics, ...result.metrics },
        raw: {
          app: result.raw?.app?.length ? result.raw.app : prev.raw?.app ?? [],
          browser: result.raw?.browser?.length ? result.raw.browser : prev.raw?.browser ?? [],
        },
        notes: [...new Set([...(prev.notes ?? []), ...(result.notes ?? [])])],
      }
    : result;
  writeFileSync(file, JSON.stringify(combined, null, 2) + "\n");
  const md = file.replace(/\.json$/, "") + ".md";
  writeFileSync(md, baselineMarkdown(combined, catalogue));
  return { file, md };
}
