import { describe, expect, it } from "vitest";

import { buildKeyTrie } from "../commands/keyTrie";

import { buildEntries, nodeAt, resolveLabels } from "./whichKeyModel";

import type { CommandContext, CommandDefinition } from "../commands/types";

const ctx = {
  vaultOpen: true,
  drawingOpen: true,
  writable: true,
  textEditing: false,
  canvasFocus: true,
  editorFocus: false,
  modalOpen: false,
  listFocus: false,
} as unknown as CommandContext;

const cmd = (
  id: string,
  title: string,
  keys: string[],
  when?: CommandDefinition["when"],
): CommandDefinition => ({
  id,
  title,
  category: "Keys",
  keys: { default: keys },
  when,
});

const commands = [
  cmd("t.rect", "Tool: Rectangle", ["g r"]),
  cmd("t.ell", "Tool: Ellipse", ["g e"]),
  cmd("f.files", "Open files", ["<leader> f f"]),
  cmd("f.grep", "Search text", ["<leader> f g"]),
  cmd("f.rec", "Recent", ["<leader> f r"]),
  cmd("w.save", "Save", ["<leader> w"], ["!drawingOpen"]),
];
const root = buildKeyTrie(commands, {}, { leader: "Space" }, "mac");
const all = (_id: string) => true;
const input = (
  path: string[],
  hasHandler: (id: string) => boolean = all,
  labels = new Map(),
) => ({
  root,
  path,
  ctx,
  hasHandler,
  labels,
});

describe("whichKeyModel", () => {
  it("lists root entries and skips dead paths", () => {
    const entries = buildEntries(input([]));
    // w.save is dead (when fails), so "Space" still has the f group only
    expect(entries.map((e) => e.chord)).toEqual(["G", "Space"]);
    expect(entries.every((e) => e.live)).toBe(true);
  });

  it("lists command children of a group", () => {
    const entries = buildEntries(input(["G"]));
    expect(entries).toEqual([
      { chord: "R", label: "Tool: Rectangle", kind: "command", live: true },
      { chord: "E", label: "Tool: Ellipse", kind: "command", live: true },
    ]);
  });

  it("drops entries without a handler", () => {
    const entries = buildEntries(input(["G"], (id) => id === "t.rect"));
    expect(entries.map((e) => e.label)).toEqual(["Tool: Rectangle"]);
  });

  it("labels groups, else counts live commands", () => {
    const plain = buildEntries(input(["Space"]));
    expect(plain).toEqual([
      { chord: "F", label: "+3 more", kind: "group", live: true },
    ]);
    const labels = resolveLabels({ "<leader> f": "find" }, "mac", "Space");
    expect(buildEntries(input(["Space"], all, labels))[0].label).toBe("find");
  });

  it("can include dead entries with live false", () => {
    const entries = buildEntries(
      { ...input(["Space"]), hasHandler: (id) => id !== "w.save" },
      false,
    );
    expect(entries.map((e) => e.chord)).toEqual(["F", "W"]);
    expect(entries[1].live).toBe(false);
  });

  it("returns nothing for an unknown path or no trie", () => {
    expect(buildEntries(input(["Q"]))).toEqual([]);
    expect(nodeAt(null, [])).toBeNull();
  });

  it("resolveLabels drops unparsable keys", () => {
    const m = resolveLabels({ "<leader> f": "a", "": "b" }, "mac", "Space");
    expect([...m.keys()]).toEqual(["Space F"]);
  });
});
