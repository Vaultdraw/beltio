import { describe, expect, it, vi } from "vitest";

import { COMMANDS, getCommand } from "../commands/commands";
import { findConflicts } from "../commands/conflicts";
import { buildKeymap, effectiveKeys } from "../commands/keymap";
import { createCommandsProvider } from "../palette/providers/commands";

import type { Platform } from "../commands/types";

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

describe("Graph commands", () => {
  it.each(Object.entries(EXPECTED))("registers %s", (id, want) => {
    const command = getCommand(id)!;
    expect(command.title).toBe(want.title);
    expect(command.category).toBe("Graph");
    expect(command.keys.default).toEqual(want.keys);
  });

  it("registers exactly the expected Graph commands", () => {
    expect(
      COMMANDS.filter((c) => c.category === "Graph")
        .map((c) => c.id)
        .sort(),
    ).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(PLATFORMS)("has no conflicts with the defaults on %s", (platform) => {
    expect(findConflicts(COMMANDS, {}, platform).size).toBe(0);
  });

  it("opens and closes only inside an open vault, local needs a drawing", () => {
    expect(getCommand("graph.open")?.when).toEqual(["vaultOpen", "!modalOpen"]);
    expect(getCommand("graph.openLocal")?.when).toEqual([
      "drawingOpen",
      "!modalOpen",
    ]);
  });

  it("is rebindable and shows up in the palette", () => {
    const overrides = { "graph.open": ["Mod+Shift+G"], "graph.fit": ["Mod+0"] };
    expect(effectiveKeys(getCommand("graph.open")!, overrides, "mac")).toEqual([
      "Mod+Shift+G",
    ]);
    const keymap = buildKeymap(COMMANDS, overrides, "mac");
    expect(keymap).toBeTruthy();
    const provider = createCommandsProvider({
      runner: {
        run: vi.fn(() => true),
        isAvailable: () => true,
        platform: "mac",
      },
      overrides: () => overrides,
    });
    const titles = provider.items().map((i) => i.title);
    for (const want of Object.values(EXPECTED)) {
      expect(titles).toContain(want.title);
    }
  });
});
