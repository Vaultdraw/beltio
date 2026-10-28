import { describe, expect, it } from "vitest";

import { COMMANDS } from "./commands";
import { conflictCount, findConflicts, whenCanOverlap } from "./conflicts";

import type { CommandDefinition } from "./types";

describe("whenCanOverlap", () => {
  it("only X vs !X is disjoint", () => {
    expect(whenCanOverlap(undefined, ["vaultOpen"])).toBe(true);
    expect(whenCanOverlap(["textEditing"], ["!textEditing"])).toBe(false);
    expect(whenCanOverlap(["vaultOpen", "!modalOpen"], ["modalOpen"])).toBe(
      false,
    );
    expect(whenCanOverlap(["vaultOpen"], ["drawingOpen"])).toBe(true);
    expect(whenCanOverlap(["canvasFocus"], ["listFocus"])).toBe(false);
  });

  it("a presentation is modal: its keys never clash with !modalOpen ones", () => {
    expect(whenCanOverlap(["present.active"], ["drawingOpen", "!modalOpen"])).toBe(false);
    expect(whenCanOverlap(["!modalOpen"], ["present.active"])).toBe(false);
    expect(whenCanOverlap(["present.active"], ["modalOpen"])).toBe(true);
    expect(whenCanOverlap(["present.active"], ["drawingOpen"])).toBe(true);
  });
});

describe("findConflicts", () => {
  it("has none with the defaults", () => {
    const result = findConflicts(COMMANDS, {}, "mac");
    expect(result.size).toBe(0);
    expect(conflictCount(result)).toBe(0);
  });

  it("reports command vs command on both sides", () => {
    const result = findConflicts(
      COMMANDS,
      { "vault.switch": ["Cmd+N"] },
      "mac",
    );
    expect(result.get("vault.switch")?.get("Mod+N")).toEqual([
      { kind: "command", id: "vault.newDrawing", title: "New drawing" },
    ]);
    expect(result.get("vault.newDrawing")?.get("Mod+N")).toEqual([
      { kind: "command", id: "vault.switch", title: "Open another vault" },
    ]);
    expect(conflictCount(result)).toBe(2);
  });

  it("ignores commands whose contexts never overlap", () => {
    const a: CommandDefinition = {
      id: "a.one",
      title: "A",
      category: "File",
      keys: { default: ["Mod+J"] },
      when: ["textEditing"],
    };
    const b: CommandDefinition = {
      id: "a.two",
      title: "B",
      category: "File",
      keys: { default: ["Mod+J"] },
      when: ["!textEditing"],
    };
    expect(findConflicts([a, b], {}, "mac").size).toBe(0);
  });

  it("flags Excalidraw keys with the action label, not for defaults", () => {
    const result = findConflicts(
      COMMANDS,
      { "vault.switch": ["Alt+Shift+C"], "file.save": ["Mod+D"] },
      "mac",
    );
    expect(result.get("vault.switch")?.get("Alt+Shift+C")).toEqual([
      {
        kind: "excalidraw",
        action: "copyAsPng",
        label: "Copy as PNG",
      },
    ]);
    // Mod+D is now the canvas.duplicateSelection command: a command clash
    expect(
      result
        .get("file.save")
        ?.get("Mod+D")
        ?.map((c) => c.kind),
    ).toEqual(["command"]);
    // Mod+P and Mod+Shift+= are defaults that overlap Excalidraw on purpose
    expect(result.get("palette.files")).toBeUndefined();
    expect(result.get("palette.commands")).toBeUndefined();
  });

  it("flags reserved keys", () => {
    const result = findConflicts(
      COMMANDS,
      { "vault.switch": ["Mod+Q"] },
      "mac",
    );
    expect(result.get("vault.switch")?.get("Mod+Q")?.[0].kind).toBe("reserved");
  });

  it("normalises Meta/Ctrl per platform", () => {
    expect(
      findConflicts(COMMANDS, { "vault.switch": ["Ctrl+N"] }, "win")
        .get("vault.switch")
        ?.has("Mod+N"),
    ).toBe(true);
    expect(
      findConflicts(COMMANDS, { "vault.switch": ["Ctrl+N"] }, "mac").size,
    ).toBe(0);
  });
});

describe("findConflicts: prefix and sequences", () => {
  const cmd = (id: string, keys: string[]): CommandDefinition => ({
    id,
    title: id.toUpperCase(),
    category: "File",
    keys: { default: keys },
  });

  it("warns both ways when a chord starts a sequence", () => {
    const result = findConflicts(
      [cmd("a", ["G"]), cmd("b", ["G G"])],
      {},
      "mac",
    );
    expect(result.get("a")?.get("G")).toEqual([
      {
        kind: "prefix",
        id: "b",
        title: "B",
        other: "G G",
        otherIsLonger: true,
      },
    ]);
    expect(result.get("b")?.get("G G")).toEqual([
      { kind: "prefix", id: "a", title: "A", other: "G", otherIsLonger: false },
    ]);
  });

  it("covers longer prefixes and ignores unrelated sequences", () => {
    const result = findConflicts(
      [cmd("a", ["G R"]), cmd("b", ["G R X"]), cmd("c", ["G S"])],
      {},
      "mac",
    );
    expect(
      result
        .get("a")
        ?.get("G R")
        ?.map((c) => c.kind),
    ).toEqual(["prefix"]);
    expect(result.get("b")?.get("G R X")).toHaveLength(1);
    expect(result.has("c")).toBe(false);
  });

  it("does not flag a command against its own keys or disjoint contexts", () => {
    expect(findConflicts([cmd("a", ["g", "G G"])], {}, "mac").size).toBe(0);
    const a = { ...cmd("a", ["G"]), when: ["textEditing" as const] };
    const b = { ...cmd("b", ["G G"]), when: ["!textEditing" as const] };
    expect(findConflicts([a, b], {}, "mac").size).toBe(0);
  });

  it("checks Excalidraw and reserved keys on the first chord only", () => {
    const dup = findConflicts([cmd("a", [])], { a: ["Alt+Shift+C X"] }, "mac");
    expect(dup.get("a")?.get("Alt+Shift+C X")?.[0]).toMatchObject({
      kind: "excalidraw",
      action: "copyAsPng",
    });
    // a later chord that equals an Excalidraw key is fine
    expect(findConflicts([cmd("a", ["X Alt+Shift+C"])], {}, "mac").size).toBe(
      0,
    );
    const reserved = findConflicts([cmd("a", ["Mod+Q X"])], {}, "mac");
    expect(reserved.get("a")?.get("Mod+Q X")?.[0].kind).toBe("reserved");
    expect(findConflicts([cmd("a", ["X Mod+Q"])], {}, "mac").size).toBe(0);
  });

  it("works through overrides", () => {
    const result = findConflicts(
      COMMANDS,
      { "vault.switch": ["Mod+N X"] },
      "mac",
    );
    expect(result.get("vault.switch")?.get("Mod+N X")?.[0]).toMatchObject({
      kind: "prefix",
      id: "vault.newDrawing",
    });
  });
});

describe("a presentation key on a tool key", () => {
  it("binding next slide to N shows no conflict with Tool: Sticky note", () => {
    const next: CommandDefinition = {
      id: "frames.next",
      title: "Frames: Next slide",
      category: "Plugins",
      keys: { default: ["ArrowRight"] },
      when: ["present.active"],
    };
    const result = findConflicts([...COMMANDS, next], { "frames.next": ["N"] }, "mac");
    expect(result.get("frames.next")?.get("N")).toBeUndefined();
    expect(result.get("tool.stickynote")?.get("N")).toBeUndefined();
  });
});
