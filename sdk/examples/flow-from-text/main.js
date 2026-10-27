// flow-from-text: the smallest plugin that answers other programs.
// `plugin.toml` declares two methods and the permission `control`; `ctx.methods.register`
// binds them. A caller gets JSON back: `vaultdraw plugin call flow-from-text draw '{"text":"A --> B"}'`.
// The plugin loads on the first call and costs nothing before that.
import { definePlugin } from "@vaultdraw/api";

const BOX = { width: 140, height: 60 };
const GAP = 70;
const MAX_NODES = 50;
// A node is an id with an optional label: A, A[Label], A(Label), A{Label}.
const NODE = /^([A-Za-z0-9_]+)\s*(?:\[(.*)\]|\((.*)\)|\{(.*)\})?$/;

/**
 * Parses Mermaid-style edges (exported for tests): `graph LR; A --> B --> C`.
 * Returns `{ dir, nodes: [{ id, label }], edges: [[from, to]] }`.
 */
export function parseFlow(text) {
  if (typeof text !== "string" || text.trim() === "") {
    throw new Error("text must be a non-empty string");
  }
  let dir = "TD";
  const nodes = new Map();
  const edges = [];
  for (const raw of text.split(/[\n;]/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("%%")) {
      continue;
    }
    const head = /^(?:graph|flowchart)\s+(TD|TB|BT|LR|RL)\b/i.exec(line);
    if (head) {
      dir = head[1].toUpperCase();
      continue;
    }
    let prev = null;
    for (const part of line.split(/\s*-{2,}>?\s*/)) {
      const m = NODE.exec(part.trim());
      if (!m) {
        throw new Error(
          `cannot read "${part.trim()}" (use A --> B, labels in [])`,
        );
      }
      const label = m[2] ?? m[3] ?? m[4];
      const known = nodes.get(m[1]);
      if (!known) {
        nodes.set(m[1], { id: m[1], label: label ?? m[1] });
      } else if (label !== undefined) {
        known.label = label;
      }
      if (prev !== null) {
        edges.push([prev, m[1]]);
      }
      prev = m[1];
    }
  }
  if (nodes.size === 0) {
    throw new Error("no nodes found");
  }
  if (nodes.size > MAX_NODES) {
    throw new Error(`too many nodes (max ${MAX_NODES})`);
  }
  return { dir, nodes: [...nodes.values()], edges };
}

/** Scene ops for a parsed flow, its top-left corner at `origin` (exported for tests). */
export function flowOps({ dir, nodes, edges }, origin = { x: 0, y: 0 }) {
  // Layer = the longest path from a root, with a pass limit so a cycle cannot loop.
  const layer = new Map(nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass++) {
    for (const [a, b] of edges) {
      if (layer.get(b) < layer.get(a) + 1 && layer.get(a) < nodes.length) {
        layer.set(b, layer.get(a) + 1);
      }
    }
  }
  const row = new Map();
  const vertical = dir === "TD" || dir === "TB" || dir === "BT";
  const reverse = dir === "BT" || dir === "RL";
  const depth = Math.max(...layer.values());
  const ops = nodes.map((n) => {
    const l = reverse ? depth - layer.get(n.id) : layer.get(n.id);
    const i = row.get(layer.get(n.id)) ?? 0;
    row.set(layer.get(n.id), i + 1);
    const along = l * ((vertical ? BOX.height : BOX.width) + GAP);
    const across = i * ((vertical ? BOX.width : BOX.height) + GAP);
    return {
      op: "add",
      ref: n.id,
      element: {
        type: "rectangle",
        x: origin.x + (vertical ? across : along),
        y: origin.y + (vertical ? along : across),
        ...BOX,
        text: n.label,
        roundness: "round",
      },
    };
  });
  const arrows = edges.map(([a, b], i) => ({
    op: "add",
    ref: `edge${i}`,
    element: { type: "arrow", start: { ref: a }, end: { ref: b } },
  }));
  return [...ops, ...arrows];
}

export default definePlugin({
  activate(ctx) {
    ctx.methods.register("draw", async (params) => {
      const path = ctx.scene.path();
      if (path === null) {
        throw new Error("open a drawing first");
      }
      const flow = parseFlow(params.text);
      const c = ctx.scene.viewportCenter();
      await ctx.scene.batch(flowOps(flow, { x: c.x - 100, y: c.y - 100 }), {
        path,
      });
      return { nodes: flow.nodes.length, arrows: flow.edges.length };
    });

    ctx.methods.register("count", () => {
      const byType = {};
      for (const el of ctx.scene.elements()) {
        byType[el.type] = (byType[el.type] ?? 0) + 1;
      }
      return {
        total: Object.values(byType).reduce((a, b) => a + b, 0),
        byType,
      };
    });
  },
});
