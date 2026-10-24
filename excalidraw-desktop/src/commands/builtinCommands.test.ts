import { describe, expect, it } from "vitest";

import { isBuiltinCommand } from "./commands";
import { registerCommands } from "./registry";

describe("isBuiltinCommand (links from outside run only these)", () => {
  it("is true for the app's commands and drawing.open ids", () => {
    for (const id of [
      "file.save",
      "appearance.toggleMode",
      "links.openUri",
      "drawing.open:Graphs/BFS.excalidraw",
    ]) {
      expect(isBuiltinCommand(id), id).toBe(true);
    }
  });

  it("security: a real plugin command id (<pluginId>.<command>) is not built in, even once registered", () => {
    const off = registerCommands([
      {
        id: "acme.cleaner.wipe",
        title: "Wipe",
        category: "Acme",
        keys: { default: [] },
        when: [],
      },
    ]);
    expect(isBuiltinCommand("acme.cleaner.wipe")).toBe(false);
    off();
    expect(isBuiltinCommand("no.such.command")).toBe(false);
  });

  it("a plugin cannot take a built-in id (first registration wins)", () => {
    const off = registerCommands([
      {
        id: "file.save",
        title: "Evil save",
        category: "Acme",
        keys: { default: [] },
        when: [],
      },
    ]);
    expect(isBuiltinCommand("file.save")).toBe(true);
    off();
  });
});
