#!/usr/bin/env node
// Summarise a V8 heap snapshot for memory attribution (PERF_HEAP_PROBE snapshots):
// self size by node type and by constructor, and every big string with its start and
// a short retainer path, so copies of image dataURLs and file texts can be counted.
// Usage: node --max-old-space-size=8192 perf/lib/heapStrings.mjs <file.heapsnapshot> [minKB=256]
import { readFileSync } from "node:fs";

const [file, minKbArg] = process.argv.slice(2);
if (!file) {
  console.error("usage: heapStrings.mjs <file.heapsnapshot> [minKB]");
  process.exit(2);
}
const minBytes = Number(minKbArg ?? 256) * 1024;
const snap = JSON.parse(readFileSync(file, "utf8"));
const meta = snap.snapshot.meta;
const nf = meta.node_fields;
const ef = meta.edge_fields;
const nodeTypes = meta.node_types[0];
const edgeTypes = meta.edge_types[0];
const N = nf.length;
const E = ef.length;
const iType = nf.indexOf("type");
const iName = nf.indexOf("name");
const iSize = nf.indexOf("self_size");
const iEdges = nf.indexOf("edge_count");
const eType = ef.indexOf("type");
const eName = ef.indexOf("name_or_index");
const eTo = ef.indexOf("to_node");
const { nodes, edges, strings } = snap;
const count = nodes.length / N;

// retainers: for each node, the first few (from node index, edge index)
const firstEdge = new Uint32Array(count + 1);
for (let i = 0, e = 0; i < count; i++) {
  firstEdge[i] = e;
  e += nodes[i * N + iEdges] * E;
}
const retainers = new Map(); // node ordinal -> [[fromOrdinal, edgeName]]
const bigIdx = new Set();
const byType = {};
const byCtor = {};
let total = 0;
for (let i = 0; i < count; i++) {
  const t = nodeTypes[nodes[i * N + iType]];
  const size = nodes[i * N + iSize];
  total += size;
  byType[t] = (byType[t] ?? 0) + size;
  if (t === "object" || t === "native") {
    const name = strings[nodes[i * N + iName]];
    byCtor[name] = (byCtor[name] ?? 0) + size;
  }
  if (size >= minBytes) {
    bigIdx.add(i);
  }
}
for (let from = 0; from < count; from++) {
  const start = firstEdge[from];
  const n = nodes[from * N + iEdges];
  for (let k = 0; k < n; k++) {
    const e = start + k * E;
    const to = edges[e + eTo] / N;
    if (bigIdx.has(to)) {
      const type = edgeTypes[edges[e + eType]];
      if (type === "weak") continue;
      const nameOrIndex = edges[e + eName];
      const label =
        type === "element" || type === "hidden"
          ? `[${nameOrIndex}]`
          : strings[nameOrIndex];
      const list = retainers.get(to) ?? [];
      if (list.length < 3) list.push([from, `${type}:${label}`]);
      retainers.set(to, list);
    }
  }
}
const mb = (b) => (b / 1048576).toFixed(1);
const describe = (i) => {
  const t = nodeTypes[nodes[i * N + iType]];
  const name = strings[nodes[i * N + iName]];
  return `${t}:${(name ?? "").slice(0, 40).replace(/\s+/g, " ")}`;
};
console.log(`total self size ${mb(total)} MB, ${count} nodes`);
console.log(
  "by type:",
  Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k, v]) => `${k} ${mb(v)}`)
    .join(", "),
);
console.log(
  "by constructor:",
  Object.entries(byCtor)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([k, v]) => `${k} ${mb(v)}`)
    .join(", "),
);
const big = [...bigIdx].sort(
  (a, b) => nodes[b * N + iSize] - nodes[a * N + iSize],
);
let bigTotal = 0;
const groups = {};
for (const i of big) {
  const size = nodes[i * N + iSize];
  bigTotal += size;
  const head = describe(i).slice(0, 30);
  groups[head] = (groups[head] ?? 0) + size;
}
console.log(
  `\n${big.length} nodes >= ${minBytes / 1024} KB, ${mb(
    bigTotal,
  )} MB in all; by start:`,
);
for (const [k, v] of Object.entries(groups)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15))
  console.log(`  ${mb(v).padStart(7)} MB  ${k}`);
// Retainer chains (CHAIN=1): the first strong retainer, up to 12 hops, for the largest nodes.
const chains = process.env.CHAIN === "1";
let rev = null;
if (chains) {
  rev = new Map();
  for (let from = 0; from < count; from++) {
    const start = firstEdge[from];
    const n = nodes[from * N + iEdges];
    for (let k = 0; k < n; k++) {
      const e = start + k * E;
      const type = edgeTypes[edges[e + eType]];
      if (type === "weak" || type === "shortcut") continue;
      const to = edges[e + eTo] / N;
      const nameOrIndex = edges[e + eName];
      const label = type === "element" || type === "hidden" ? `[${nameOrIndex}]` : strings[nameOrIndex];
      const list = rev.get(to);
      if (!list) rev.set(to, [[from, `${type}:${label}`]]);
      else if (list.length < 4) list.push([from, `${type}:${label}`]);
    }
  }
}
const chainOf = (i) => {
  const seen = new Set([i]);
  const out = [];
  let cur = i;
  for (let h = 0; h < 14; h++) {
    const list = (rev.get(cur) ?? []).filter(([f]) => !seen.has(f));
    if (!list.length) break;
    const [from, label] = list[0];
    out.push(`${label} <- ${describe(from)}`);
    seen.add(from);
    cur = from;
  }
  return out.join("\n        ");
};
console.log("\nlargest 40 with retainers:");
for (const i of big.slice(0, 40)) {
  const r = (retainers.get(i) ?? [])
    .map(([from, label]) => `${label} <- ${describe(from)}`)
    .join(" | ");
  console.log(
    `  ${mb(nodes[i * N + iSize]).padStart(6)} MB ${describe(i)}  ::  ${r}`,
  );  if (chains) {
    console.log(`        ${chainOf(i)}`);
  }
}
