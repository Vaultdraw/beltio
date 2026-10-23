import { describe, expect, it } from "vitest";

import { COMMANDS } from "./commands";
import { buildKeymap } from "./keymap";
import { buildKeyTrie } from "./keyTrie";

import type { CommandDefinition } from "./types";

const cmd = (id: string, keys: string[]): CommandDefinition => ({
  id,
  title: id,
  category: "File",
  keys: { default: keys },
});

describe("buildKeyTrie", () => {
  it("is null when no sequence is configured", () => {
    expect(
      buildKeyTrie(
        [cmd("a.b", ["Mod+S"]), cmd("a.c", [])],
        {},
        { leader: "Backslash" },
        "mac",
      ),
    ).toBeNull();
  });

  it("is null for the built-in commands (no default sequences)", () => {
    expect(
      buildKeyTrie(COMMANDS, {}, { leader: "Backslash" }, "mac"),
    ).toBeNull();
  });

  it("builds nested nodes, expands the leader, shares prefixes", () => {
    const root = buildKeyTrie(
      [
        cmd("a.files", ["<leader> f f"]),
        cmd("a.find", ["<leader> f g"]),
        cmd("a.first", ["g g"]),
      ],
      {},
      { leader: "Space" },
      "mac",
    );
    expect([...(root as Map<string, unknown>).keys()].sort()).toEqual([
      "G",
      "Space",
    ]);
    const f = root?.get("Space")?.next?.get("F");
    expect(f?.commands).toBeNull();
    expect(f?.next?.get("F")?.commands?.map((c) => c.id)).toEqual(["a.files"]);
    expect(f?.next?.get("G")?.next).toBeNull();
    expect(root?.get("G")?.next?.get("G")?.commands?.[0].id).toBe("a.first");
  });

  it("makes a node both a binding and a prefix", () => {
    const root = buildKeyTrie(
      [cmd("a.short", ["g g"]), cmd("a.long", ["g g g"])],
      {},
      { leader: "Backslash" },
      "mac",
    );
    const gg = root?.get("G")?.next?.get("G");
    expect(gg?.commands?.[0].id).toBe("a.short");
    expect(gg?.next?.get("G")?.commands?.[0].id).toBe("a.long");
    // Built in the other order too.
    const flipped = buildKeyTrie(
      [cmd("a.long", ["g g g"]), cmd("a.short", ["g g"])],
      {},
      { leader: "Backslash" },
      "mac",
    );
    const node = flipped?.get("G")?.next?.get("G");
    expect(node?.commands?.[0].id).toBe("a.short");
    expect(node?.next?.size).toBe(1);
  });

  it("uses overrides, and an unusable leader drops the entry", () => {
    const commands = [cmd("a.x", ["Mod+X"])];
    expect(
      buildKeyTrie(commands, { "a.x": ["Mod+K Mod+S"] }, { leader: "x" }, "mac")
        ?.get("Mod+K")
        ?.next?.get("Mod+S")?.commands?.[0].id,
    ).toBe("a.x");
    expect(
      buildKeyTrie(
        commands,
        { "a.x": ["<leader> x"] },
        { leader: "bogus key" },
        "mac",
      ),
    ).toBeNull();
  });

  it("keeps the single-chord map unchanged (parity over COMMANDS)", () => {
    const withSeq = buildKeymap(
      [...COMMANDS, cmd("t.seq", ["g g", "Mod+Alt+Shift+F9"])],
      {},
      "mac",
    );
    const without = buildKeymap(COMMANDS, {}, "mac");
    expect(withSeq.has("G G")).toBe(false);
    for (const [chord, list] of without) {
      expect(withSeq.get(chord)).toEqual(list);
    }
    expect(withSeq.get("Mod+Alt+Shift+F9")?.[0].id).toBe("t.seq");
    expect(withSeq.size).toBe(without.size + 1);
  });
});
