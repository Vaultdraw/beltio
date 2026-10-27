import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { COMMANDS } from "../../../../excalidraw-desktop/src/commands/commands";
import { findConflicts } from "../../../../excalidraw-desktop/src/commands/conflicts";
import { parseManifest } from "../../../../sdk/examples/testing/readManifest";

import type {
  CommandDefinition,
  Platform,
} from "../../../../excalidraw-desktop/src/commands/types";

// The graph's commands, as plugin.toml declares them: the ids, titles and keys the app always had.
const EXPECTED: Record<string, { title: string; keys: string[] }> = {
  "graph.open": { title: "Graph: Open graph view", keys: ["Mod+Alt+G"] },
  "graph.openLocal": { title: "Graph: Open local graph", keys: ["Mod+Alt+L"] },
  "graph.toggleOrphans": { title: "Graph: Toggle orphans", keys: [] },
  "graph.toggleTags": { title: "Graph: Toggle tags", keys: [] },
  "graph.toggleUnresolved": {
    title: "Graph: Toggle unresolved links",
    keys: [],
  },
  "graph.fit": { title: "Graph: Fit graph to view", keys: ["0"] },
  // In-view keys: only while focus is in the graph (graphFocus).
  "graph.moveLeft": {
    title: "Graph: Focus node to the left",
    keys: ["H", "ArrowLeft"],
  },
  "graph.moveRight": {
    title: "Graph: Focus node to the right",
    keys: ["L", "ArrowRight"],
  },
  "graph.moveUp": { title: "Graph: Focus node above", keys: ["K", "ArrowUp"] },
  "graph.moveDown": {
    title: "Graph: Focus node below",
    keys: ["J", "ArrowDown"],
  },
  "graph.openNode": { title: "Graph: Open focused node", keys: ["Enter"] },
  "graph.focusFilter": { title: "Graph: Focus the filter", keys: ["Slash"] },
  "graph.toggleLocal": {
    title: "Graph: Switch between global and local graph",
    keys: ["Shift+L"],
  },
  "graph.depth1": { title: "Graph: Local depth 1", keys: ["1"] },
  "graph.depth2": { title: "Graph: Local depth 2", keys: ["2"] },
  "graph.depth3": { title: "Graph: Local depth 3", keys: ["3"] },
  "graph.hints": { title: "Graph: Show link hints", keys: ["F", "Shift+F"] },
  "graph.zoomIn": { title: "Graph: Zoom in", keys: ["Equal", "Shift+Equal"] },
  "graph.zoomOut": { title: "Graph: Zoom out", keys: ["Minus"] },
  "graph.close": { title: "Graph: Close graph", keys: ["Escape"] },
  "graph.toggleArrows": { title: "Graph: Toggle arrows", keys: [] },
  "graph.toggleColourBy": {
    title: "Graph: Toggle colour by folder or mono",
    keys: [],
  },
  "graph.toggleSettings": { title: "Graph: Toggle settings panel", keys: [] },
  "graph.resetDisplay": {
    title: "Graph: Reset display and forces",
    keys: [],
  },
};
const PLATFORMS: Platform[] = ["mac", "win", "linux"];

const info = parseManifest(
  readFileSync(path.resolve(__dirname, "../plugin.toml"), "utf8"),
);
const declared = info.contributes.commands;
const defs: CommandDefinition[] = declared.map((c) => ({
  id: `graph.${c.id}`,
  title: c.title,
  category: info.name,
  keys: { default: c.keys },
  when: c.when as CommandDefinition["when"],
  ...(c.repeat ? { repeat: true } : {}),
}));

describe("Graph plugin commands", () => {
  it.each(Object.entries(EXPECTED))("declares %s", (id, want) => {
    const command = defs.find((d) => d.id === id)!;
    expect(command.title).toBe(want.title);
    expect(command.keys.default).toEqual(want.keys);
  });

  it("declares exactly the expected commands, in the Graph category", () => {
    expect(defs.map((c) => c.id).sort()).toEqual(Object.keys(EXPECTED).sort());
    expect(new Set(defs.map((d) => d.category))).toEqual(new Set(["Graph"]));
  });

  it.each(PLATFORMS)("has no conflicts with the defaults on %s", (platform) => {
    expect(findConflicts([...COMMANDS, ...defs], {}, platform).size).toBe(0);
  });

  it("opens and closes only inside an open vault, local needs a drawing", () => {
    const by = (id: string) => defs.find((d) => d.id === id)!;
    expect(by("graph.open").when).toEqual(["vaultOpen", "!modalOpen"]);
    expect(by("graph.openLocal").when).toEqual(["drawingOpen", "!modalOpen"]);
  });

  it("repeats the movement and zoom keys while held, and only those", () => {
    expect(
      defs
        .filter((d) => d.repeat)
        .map((d) => d.id)
        .sort(),
    ).toEqual(
      [
        "graph.moveLeft",
        "graph.moveRight",
        "graph.moveUp",
        "graph.moveDown",
        "graph.zoomIn",
        "graph.zoomOut",
      ].sort(),
    );
  });
});
