import { describe, expect, it } from "vitest";

import { fakeGraph } from "./fakeGraph";
import {
  compileQuery,
  fold,
  nodeColours,
  nodeRadii,
  parseQuery,
  searchBright,
  visibilityMask,
} from "./filters";
import { packRgba } from "./renderer/shared";
import { deriveGraphColours, FALLBACK_TOKENS } from "./theme";
import { DEFAULT_GRAPH_SETTINGS } from "./settings";
import { FLAG_ORPHAN, FLAG_TAG, FLAG_UNRESOLVED } from "./types";

const g = fakeGraph(300, 3);
const palette = deriveGraphColours(FALLBACK_TOKENS).palette;
const ids = (pred: (i: number) => boolean) =>
  Array.from({ length: g.nodeCount }, (_, i) => i).filter(pred);

describe("query grammar", () => {
  it("parses prefixes, negation and quotes", () => {
    expect(parseQuery('path:"My Folder" -tag:#Old Café file:bfs')).toEqual([
      { negate: false, kind: "path", value: "my folder" },
      { negate: true, kind: "tag", value: "old" },
      { negate: false, kind: "name", value: "cafe" },
      { negate: false, kind: "name", value: "bfs" },
    ]);
    expect(parseQuery("   ")).toEqual([]);
    expect(fold("Éclair")).toBe("eclair");
  });

  it("name matches the label, case and accent blind", () => {
    const m = compileQuery(g, '"DRAWING 17"')!;
    const hit = ids(m);
    expect(hit.length).toBeGreaterThan(0);
    expect(
      hit.every((i) => g.label(i).toLowerCase().includes("drawing 17")),
    ).toBe(true);
  });

  it("path: matches drawings by path and others by label", () => {
    const m = compileQuery(g, "path:f1/")!;
    const hit = ids(m).filter(g.isDrawing.bind(g));
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.every((i) => g.path(i)!.toLowerCase().includes("f1/"))).toBe(
      true,
    );
  });

  it("tag: matches the tag node and the drawings linked to it", () => {
    const tag = ids((i) => (g.flags[i] & FLAG_TAG) !== 0)[0];
    const m = compileQuery(g, `tag:${g.label(tag)}`)!;
    expect(m(tag)).toBe(true);
    const linked = Array.from(g.neighbours(tag)).filter((i) => g.isDrawing(i));
    expect(linked.length).toBeGreaterThan(0);
    expect(linked.every(m)).toBe(true);
    const outsider = ids(
      (i) => g.isDrawing(i) && !g.neighbours(i).includes(tag),
    )[0];
    expect(m(outsider)).toBe(false);
  });

  it("tag: includes child tags", () => {
    const tag = ids((i) => (g.flags[i] & FLAG_TAG) !== 0)[0];
    const parent = g.label(tag).slice(1);
    const child = {
      ...g,
      flags: g.flags,
      label: (i: number) => (i === tag ? `#${parent}/sub` : g.label(i)),
    } as typeof g;
    expect(compileQuery(child, `tag:#${parent}`)!(tag)).toBe(true);
  });

  it("terms are ANDed and - negates; empty query is null", () => {
    expect(compileQuery(g, "")).toBeNull();
    const both = compileQuery(g, "drawing -drawing 1")!;
    expect(both(g.nodeCount - 1)).toBe(false);
    const a = ids(compileQuery(g, "drawing")!).length;
    const b = ids(both).length;
    expect(b).toBeLessThan(a);
  });
});

describe("masks", () => {
  it("shows everything by default; hides tags, ghosts and orphans on request", () => {
    expect(visibilityMask(g, DEFAULT_GRAPH_SETTINGS)).toBeNull();
    const m = visibilityMask(g, {
      ...DEFAULT_GRAPH_SETTINGS,
      showTags: false,
    })!;
    for (let i = 0; i < g.nodeCount; i++) {
      expect(m[i] === 1).toBe((g.flags[i] & FLAG_TAG) !== 0);
    }
    const all = visibilityMask(g, {
      showTags: true,
      showUnresolved: true,
      showOrphans: true,
    });
    expect(all).toBeNull();
    const none = visibilityMask(g, {
      showTags: true,
      showUnresolved: false,
      showOrphans: false,
    })!;
    for (let i = 0; i < g.nodeCount; i++) {
      const hidden = (g.flags[i] & (FLAG_UNRESOLVED | FLAG_ORPHAN)) !== 0;
      expect(none[i] === 1).toBe(hidden);
    }
  });

  it("works on a local subset and ignores orphans there", () => {
    const subset = Uint32Array.from([0, 1, g.nodeCount - 1]);
    const m = visibilityMask(
      g,
      { showTags: false, showUnresolved: true, showOrphans: false },
      subset,
    )!;
    expect(m.length).toBe(3);
    expect(m[2]).toBe(1); // a tag node
  });

  it("search keeps matches bright and is null when empty", () => {
    expect(searchBright(g, "")).toBeNull();
    const b = searchBright(g, "drawing 5")!;
    expect(b[5]).toBe(1);
    expect(b[6]).toBe(0);
  });
});

describe("colours and radii", () => {
  it("folder colours come from the palette, ghosts and tags are special", () => {
    const c = nodeColours(g, DEFAULT_GRAPH_SETTINGS, palette);
    const ghost = ids((i) => (g.flags[i] & FLAG_UNRESOLVED) !== 0)[0];
    const tag = ids((i) => (g.flags[i] & FLAG_TAG) !== 0)[0];
    expect(c[ghost]).not.toBe(c[tag]);
    const twoSameFolder = ids(
      (i) => g.isDrawing(i) && g.folder[i] === g.folder[0],
    ).slice(0, 2);
    expect(c[twoSameFolder[0]]).toBe(c[twoSameFolder[1]]);
  });

  it("mono paints every drawing the same", () => {
    const c = nodeColours(g, { colourBy: "mono", groups: [] }, palette);
    const set = new Set(ids((i) => g.isDrawing(i)).map((i) => c[i]));
    expect(set.size).toBe(1);
  });

  it("the first matching group wins", () => {
    const c = nodeColours(
      g,
      {
        colourBy: "folder",
        groups: [
          { query: "drawing 1", colour: "#ff0000" },
          { query: "drawing", colour: "#00ff00" },
        ],
      },
      palette,
    );
    expect(c[1]).toBe(packRgba(255, 0, 0));
    expect(c[2]).toBe(packRgba(0, 255, 0));
  });

  it("radius grows with links and scales with node size", () => {
    const r1 = nodeRadii(g, 1);
    const r2 = nodeRadii(g, 2);
    expect(r2[0]).toBeCloseTo(r1[0] * 2);
    const deg = (i: number) => g.outDeg[i] + g.inDeg[i];
    const all = ids(() => true);
    const hub = all.reduce((a, b) => (deg(b) > deg(a) ? b : a));
    const leaf = all.reduce((a, b) => (deg(b) < deg(a) ? b : a));
    expect(r1[hub]).toBeGreaterThan(r1[leaf]);
  });
});
