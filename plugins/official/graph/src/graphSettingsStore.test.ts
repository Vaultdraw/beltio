import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createGraphSettingsSaver,
  freshGraphSettings,
  graphSettingsChanges,
  loadGraphSettings,
  parseGraphSettings,
  type SettingsTable,
} from "./graphSettingsStore";
import { DEFAULT_GRAPH_SETTINGS } from "./settings";

/** A fake own table (`ctx.vault.table`): the `[graph]` table as an object. */
const fakeBackend = (graph: Record<string, unknown> = {}) => {
  const calls: { key: string; value: unknown }[][] = [];
  const invoke: SettingsTable = {
    read: vi.fn(async () => JSON.parse(JSON.stringify(graph))),
    update: vi.fn(async (changes) => {
      calls.push([...changes]);
      for (const { key, value } of changes) {
        if (value === null) {
          delete graph[key];
        } else {
          graph[key] = value;
        }
      }
    }),
  };
  return { invoke, calls, file: { graph } };
};

afterEach(() => vi.useRealTimers());

describe("parseGraphSettings", () => {
  it("returns the defaults for missing or malformed input", () => {
    for (const bad of [undefined, null, 5, []]) {
      expect(parseGraphSettings(bad)).toEqual(DEFAULT_GRAPH_SETTINGS);
    }
  });

  it("clamps numbers, drops bad values and ignores unknown keys", () => {
    const s = parseGraphSettings({
      node_size: 99,
      link_thickness: -3,
      text_fade: "x",
      force_repel: 1000,
      force_distance: 1,
      force_centre: Number.NaN,
      colour_by: "rainbow",
      local_depth: 7,
      show_tags: "yes",
      arrows: true,
      mystery: 1,
      groups: [
        { query: "tag:#a", colour: "#f00" },
        { query: 1, colour: "#0f0" },
        null,
      ],
    });
    expect(s.nodeSize).toBe(5);
    expect(s.linkThickness).toBe(0.2);
    expect(s.textFade).toBe(DEFAULT_GRAPH_SETTINGS.textFade);
    expect(s.forces.repel).toBe(20);
    expect(s.forces.linkDistance).toBe(5);
    expect(s.forces.centre).toBe(DEFAULT_GRAPH_SETTINGS.forces.centre);
    expect(s.colourBy).toBe("folder");
    expect(s.localDepth).toBe(2);
    expect(s.showTags).toBe(DEFAULT_GRAPH_SETTINGS.showTags);
    expect(s.arrows).toBe(true);
    expect(s.groups).toEqual([{ query: "tag:#a", colour: "#f00" }]);
    expect("mystery" in s).toBe(false);
  });

  it("never shares mutable defaults between calls", () => {
    const a = parseGraphSettings({});
    a.forces.repel = 1;
    a.groups.push({ query: "x", colour: "y" });
    expect(parseGraphSettings({})).toEqual(DEFAULT_GRAPH_SETTINGS);
    expect(DEFAULT_GRAPH_SETTINGS.groups).toEqual([]);
  });
});

describe("graphSettingsChanges", () => {
  it("is empty when nothing changed and nulls values reset to default", () => {
    const base = freshGraphSettings();
    expect(graphSettingsChanges(base, freshGraphSettings())).toEqual([]);
    const changed = { ...base, showTags: false };
    expect(graphSettingsChanges(base, changed)).toEqual([
      { key: "show_tags", value: false },
    ]);
    expect(graphSettingsChanges(changed, base)).toEqual([
      { key: "show_tags", value: null },
    ]);
  });
});

describe("load and save round trip", () => {
  it("saves debounced, writes only the diff, and loads back identically", async () => {
    vi.useFakeTimers();
    const { invoke, calls, file } = fakeBackend();
    const loaded = await loadGraphSettings(invoke);
    expect(loaded).toEqual(DEFAULT_GRAPH_SETTINGS);
    const saver = createGraphSettingsSaver(invoke, loaded);

    const next = {
      ...loaded,
      showOrphans: false,
      groups: [{ query: "path:Notes", colour: "#123456" }],
      forces: { ...loaded.forces, repel: 5 },
    };
    saver.save({ ...next, nodeSize: 2 });
    saver.save(next);
    await vi.advanceTimersByTimeAsync(499);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(calls).toHaveLength(1);
    expect(calls[0].map((c) => c.key).sort()).toEqual([
      "force_repel",
      "groups",
      "show_orphans",
    ]);

    expect(await loadGraphSettings(invoke)).toEqual(next);

    saver.save(loaded);
    await saver.flush();
    expect(calls).toHaveLength(2);
    expect(file.graph).toEqual({});
  });

  it("falls back to defaults when the load fails and retries after a failed write", async () => {
    const boom = vi.fn(async () => {
      throw new Error("nope");
    });
    const failing: SettingsTable = { read: boom, update: boom };
    expect(await loadGraphSettings(failing)).toEqual(DEFAULT_GRAPH_SETTINGS);
    const saver = createGraphSettingsSaver(failing, freshGraphSettings(), 0);
    saver.save({ ...freshGraphSettings(), arrows: true });
    await saver.flush();
    saver.save({ ...freshGraphSettings(), arrows: true });
    await saver.flush();
    expect(boom).toHaveBeenCalledTimes(3); // load + two attempts, not skipped
  });
});
