import { describe, expect, it } from "vitest";

import { COMMANDS, defaultKeys, getCommand, isCommandId } from "./commands";
import {
  buildKeymap,
  effectiveKeys,
  isCustomised,
  overrideFor,
} from "./keymap";

import type { CommandDefinition } from "./types";

const cmd = (id: string) => getCommand(id) as CommandDefinition;

describe("commands registry", () => {
  it("has unique ids in dotted namespace.camelCase form", () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z][a-zA-Z]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/);
    }
    expect(isCommandId("file.save")).toBe(true);
    expect(isCommandId("nope.nope")).toBe(false);
    expect(getCommand("nope")).toBeUndefined();
  });

  it("keeps the Ctrl aliases as extra macOS defaults", () => {
    const keys = (id: string, platform: "mac" | "win") =>
      defaultKeys(getCommand(id)!, platform);
    expect(keys("file.save", "mac")).toEqual([
      "Mod+S",
      "Mod+Shift+S",
      "Ctrl+S",
    ]);
    expect(keys("file.save", "win")).toEqual(["Mod+S", "Mod+Shift+S"]);
    expect(keys("settings.open", "mac")).toEqual(["Mod+Comma", "Ctrl+Comma"]);
    expect(keys("navigator.focusSearch", "mac")).toEqual([
      "Mod+Shift+F",
      "Ctrl+Shift+F",
    ]);
    expect(keys("navigator.focusSearch", "win")).toEqual(["Mod+Shift+F"]);
    expect(keys("vault.newFromTemplate", "mac")).toEqual([
      "Mod+Alt+N",
      "Ctrl+Alt+N",
    ]);
    expect(keys("vault.newFromTemplate", "win")).toEqual(["Mod+Alt+N"]);
  });

  it("uses platform keys over the default", () => {
    const c: CommandDefinition = {
      ...cmd("file.save"),
      keys: { default: ["Mod+S"], mac: ["Mod+Alt+S"] },
    };
    expect(defaultKeys(c, "mac")).toEqual(["Mod+Alt+S"]);
    expect(defaultKeys(c, "win")).toEqual(["Mod+S"]);
  });
});

describe("palette modes and the legacy palette.quickSwitcher id", () => {
  const files = () => cmd("palette.files");
  const commands = () => cmd("palette.commands");

  it("splits the palette: Mod+P files, Mod+Shift+P and Mod+/ commands", () => {
    expect(effectiveKeys(files(), {}, "mac")).toEqual(["Mod+P"]);
    expect(effectiveKeys(commands(), {}, "mac")).toEqual([
      "Mod+Shift+P",
      "Mod+Slash",
    ]);
    expect(isCommandId("palette.quickSwitcher")).toBe(true);
    expect(getCommand("palette.quickSwitcher")).toBeUndefined();
  });

  it("applies a legacy override to files mode, minus the commands keys", () => {
    const legacy = { "palette.quickSwitcher": ["Mod+K"] };
    expect(effectiveKeys(files(), legacy, "mac")).toEqual(["Mod+K"]);
    expect(effectiveKeys(commands(), legacy, "mac")).toEqual([
      "Mod+Shift+P",
      "Mod+Slash",
    ]);
    // F41's defaults plus an extra key, as the Hotkeys page wrote them.
    const extended = {
      "palette.quickSwitcher": ["Mod+P", "Mod+Slash", "Mod+Shift+P", "Mod+K"],
    };
    expect(effectiveKeys(files(), extended, "mac")).toEqual(["Mod+P", "Mod+K"]);
    expect(
      effectiveKeys(files(), { "palette.quickSwitcher": [] }, "mac"),
    ).toEqual([]);
  });

  it("the new id wins over the legacy one", () => {
    const both = {
      "palette.quickSwitcher": ["Mod+K"],
      "palette.files": ["Mod+J"],
    };
    expect(effectiveKeys(files(), both, "mac")).toEqual(["Mod+J"]);
  });
});

describe("keymap", () => {
  it("uses defaults without overrides and the override list with one", () => {
    expect(effectiveKeys(cmd("vault.newDrawing"), {}, "mac")).toEqual([
      "Mod+N",
    ]);
    expect(
      effectiveKeys(
        cmd("vault.newDrawing"),
        { "vault.newDrawing": ["Cmd+Alt+N"] },
        "mac",
      ),
    ).toEqual(["Mod+Alt+N"]);
    expect(
      effectiveKeys(cmd("vault.newDrawing"), { "vault.newDrawing": [] }, "mac"),
    ).toEqual([]);
    expect(
      effectiveKeys(cmd("vault.newDrawing"), { toString: ["x"] }, "mac"),
    ).toEqual(["Mod+N"]);
  });

  it("overrideFor returns null when equal to the defaults", () => {
    const c = cmd("view.zoomIn");
    expect(
      overrideFor(c, ["Cmd+Shift+Equal", "Mod+Shift+NumpadAdd"], "mac"),
    ).toBeNull();
    expect(
      overrideFor(c, ["Mod+Shift+NumpadAdd", "Mod+Shift+Equal"], "win"),
    ).toBeNull();
    expect(overrideFor(c, ["Mod+Shift+Equal"], "mac")).toEqual([
      "Mod+Shift+Equal",
    ]);
    expect(overrideFor(c, [], "mac")).toEqual([]);
    expect(overrideFor(cmd("vault.switch"), [], "mac")).toBeNull();
    expect(overrideFor(cmd("vault.switch"), ["Mod+Alt+O"], "mac")).toEqual([
      "Mod+Alt+O",
    ]);
  });

  it("isCustomised compares with the defaults", () => {
    const c = cmd("file.save");
    expect(isCustomised(c, {}, "mac")).toBe(false);
    const all = ["Mod+S", "Mod+Shift+S", "Ctrl+S"];
    expect(isCustomised(c, { "file.save": all }, "mac")).toBe(false);
    expect(
      isCustomised(
        c,
        { "file.save": ["Ctrl+S", "Meta+S", "Shift+Meta+S"] },
        "mac",
      ),
    ).toBe(false);
    expect(isCustomised(c, { "file.save": ["Mod+S"] }, "mac")).toBe(true);
    expect(
      isCustomised(c, { "file.save": ["Mod+S", "Mod+Shift+S"] }, "win"),
    ).toBe(false);
    expect(isCustomised(c, { "file.save": [] }, "mac")).toBe(true);
  });

  it("buildKeymap maps normalised chords in registry order", () => {
    const map = buildKeymap(COMMANDS, {}, "mac");
    expect(map.get("Mod+S")?.map((c) => c.id)).toEqual([
      "file.save",
      "notes.save",
    ]);
    expect(map.get("Mod+Shift+Equal")?.map((c) => c.id)).toEqual([
      "view.zoomIn",
    ]);
    expect(map.get("Meta+S")).toBeUndefined();
    const shared = buildKeymap(
      COMMANDS,
      { "vault.newDrawing": ["Meta+S"], "file.duplicate": ["Mod+S"] },
      "mac",
    );
    expect(shared.get("Mod+S")?.map((c) => c.id)).toEqual([
      "file.save",
      "vault.newDrawing",
      "file.duplicate",
      "notes.save",
    ]);
    expect(shared.has("Mod+N")).toBe(false);
  });
});
