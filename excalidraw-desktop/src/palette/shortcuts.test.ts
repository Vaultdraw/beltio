import { describe, expect, it } from "vitest";

import { formatChordParts } from "../commands/keys";

import {
  commandShortcutLabel,
  excalidrawShortcutLabel,
  formatKeyLabel,
  keyCapGroups,
} from "./shortcuts";

describe("palette shortcut labels", () => {
  it("formats registry commands with overrides", () => {
    expect(commandShortcutLabel("vault.newDrawing", {}, "mac")).toBe("⌘N");
    expect(
      commandShortcutLabel(
        "vault.newDrawing",
        { "vault.newDrawing": [] },
        "mac",
      ),
    ).toBe("");
    expect(
      commandShortcutLabel(
        "vault.newDrawing",
        { "vault.newDrawing": ["Mod+Alt+K"] },
        "win",
      ),
    ).toBe("Ctrl+Alt+K");
    expect(commandShortcutLabel("nope", {}, "mac")).toBe("");
  });

  it("converts Excalidraw's display shortcuts", () => {
    expect(excalidrawShortcutLabel("Cmd+Shift+L", "mac")).toBe("⇧⌘L");
    expect(excalidrawShortcutLabel("Ctrl+G", "win")).toBe("Ctrl+G");
    expect(excalidrawShortcutLabel("Shift+Option+D", "mac")).toBe("⌥⇧D");
    expect(excalidrawShortcutLabel("R", "mac")).toBe("R");
    expect(excalidrawShortcutLabel(null, "mac")).toBe("");
    expect(excalidrawShortcutLabel("Space+drag", "mac")).toBe("Space+drag");
  });
});

describe("sequence labels", () => {
  it("joins one group per chord with a space", () => {
    expect(formatKeyLabel("g g", "mac")).toBe("G G");
    expect(formatKeyLabel("Mod+Alt+K Mod+S", "mac")).toBe("⌥⌘K ⌘S");
    expect(formatKeyLabel("Mod+Alt+K Mod+S", "win")).toBe("Ctrl+Alt+K Ctrl+S");
  });

  it("shows <leader> as the leader key, Backslash by default", () => {
    expect(formatKeyLabel("<leader> f f", "mac")).toBe("\\ F F");
    expect(formatKeyLabel("<leader> f", "mac", "Space")).toBe("Space F");
    expect(formatKeyLabel("<leader> f", "win", "Mod+Space")).toBe(
      "Ctrl+Space F",
    );
  });

  it("leaves single chords exactly as before", () => {
    expect(formatKeyLabel("Mod+Shift+S", "mac")).toBe("⇧⌘S");
    expect(formatKeyLabel("Mod+Shift+S", "win")).toBe("Ctrl+Shift+S");
  });

  it("labels a command's first sequence, with a custom formatter", () => {
    expect(
      commandShortcutLabel(
        "vault.newDrawing",
        { "vault.newDrawing": ["Mod+Alt+K Mod+S", "Mod+N"] },
        "win",
      ),
    ).toBe("Ctrl+Alt+K Ctrl+S");
    expect(
      commandShortcutLabel(
        "vault.newDrawing",
        { "vault.newDrawing": ["<leader> n"] },
        "win",
        undefined,
        "Space",
      ),
    ).toBe("Space N");
  });

  it("key cap groups: one array per chord", () => {
    expect(keyCapGroups("Mod+Alt+K g", "mac", formatChordParts)).toEqual([
      ["⌥", "⌘", "K"],
      ["G"],
    ]);
    expect(
      keyCapGroups("<leader> f", "mac", formatChordParts, "Space"),
    ).toEqual([["Space"], ["F"]]);
  });
});
