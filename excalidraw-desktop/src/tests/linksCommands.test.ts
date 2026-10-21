import { afterEach, describe, expect, it, vi } from "vitest";

import {
  allCommands,
  COMMANDS,
  getCommand,
  isCommandId,
} from "../commands/commands";
import { findConflicts } from "../commands/conflicts";
import {
  drawingOpenCommandId,
  drawingOpenCommands,
  parseDrawingOpenCommandId,
} from "../commands/drawingCommands";
import { readContext } from "../commands/context";
import { installCommandDispatcher } from "../commands/dispatcher";
import {
  getRegisteredHandler,
  registerCommandHandlers,
  registerCommandPrefixHandler,
} from "../commands/handlerRegistry";
import { buildKeymap, effectiveKeys } from "../commands/keymap";
import { createCommandsProvider } from "../palette/providers/commands";
import {
  configToPreferences,
  preferencesToConfigChanges,
} from "../vault/settingsSync";
import { DEFAULT_PREFERENCES } from "../vault/preferences";

import type { Platform } from "../commands/types";

const PLATFORMS: Platform[] = ["mac", "win", "linux"];

const EXPECTED: Record<string, { title: string; keys: string[] }> = {
  "links.linkSelection": {
    title: "Links: Link selection to drawing…",
    keys: ["Mod+Alt+K"],
  },
  "links.insert": { title: "Links: Insert link…", keys: [] },
  "links.openUnderSelection": {
    title: "Links: Open link under selection",
    keys: ["Mod+Alt+Enter"],
  },
  "links.toggleDock": {
    title: "Links: Toggle backlinks panel",
    keys: ["Mod+Alt+B"],
  },
  "links.back": { title: "Links: Go back", keys: ["Mod+Alt+ArrowLeft"] },
  "links.forward": {
    title: "Links: Go forward",
    keys: ["Mod+Alt+ArrowRight"],
  },
  "links.copyLinkToDrawing": {
    title: "Links: Copy link to this drawing",
    keys: [],
  },
  "links.hints": { title: "Links: Show link hints", keys: ["Shift+F"] },
  "links.toggleStyling": { title: "Links: Toggle link styling", keys: [] },
  "links.toggleHoverPreview": {
    title: "Links: Toggle link hover preview",
    keys: [],
  },
  "links.bindDrawingHotkey": {
    title: "Links: Assign hotkey to this drawing",
    keys: [],
  },
};

describe("Links commands", () => {
  it.each(Object.entries(EXPECTED))("registers %s", (id, want) => {
    const command = getCommand(id)!;
    expect(command.title).toBe(want.title);
    expect(command.category).toBe("Links");
    expect(command.keys.default).toEqual(want.keys);
  });

  it("hints work only on the canvas, never while typing", () => {
    expect(getCommand("links.hints")?.when).toEqual([
      "canvasFocus",
      "!textEditing",
      "!modalOpen",
      "drawingOpen",
    ]);
  });

  it("does not take plain Excalidraw tool letters", () => {
    for (const command of COMMANDS.filter((c) => c.category === "Links")) {
      for (const chord of command.keys.default) {
        expect(chord).not.toMatch(/^[A-Z0-9]$/);
      }
    }
  });

  it.each(PLATFORMS)("has no conflicts with the defaults on %s", (platform) => {
    expect(findConflicts(COMMANDS, {}, platform).size).toBe(0);
  });

  it("has unique ids", () => {
    expect(new Set(COMMANDS.map((c) => c.id)).size).toBe(COMMANDS.length);
  });
});

describe("drawing.open:<path> commands", () => {
  const path = "Graphs/Breadth First.excalidraw";
  const id = "drawing.open:Graphs/Breadth First.excalidraw";

  afterEach(() => vi.restoreAllMocks());

  it("builds and parses ids", () => {
    expect(drawingOpenCommandId(path)).toBe(id);
    expect(parseDrawingOpenCommandId(id)).toBe(path);
    expect(parseDrawingOpenCommandId("drawing.open:")).toBeNull();
    expect(parseDrawingOpenCommandId("file.save")).toBeNull();
  });

  it("creates commands from [hotkeys] entries", () => {
    const commands = drawingOpenCommands({
      [id]: ["Mod+Alt+1"],
      "file.save": ["Mod+S"],
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      id,
      title: "Open drawing: Breadth First",
      category: "Links",
    });
    expect(allCommands({})).toEqual(COMMANDS);
    expect(allCommands({})).toBe(allCommands({}));
    expect(allCommands({ [id]: [] })).toHaveLength(COMMANDS.length + 1);
    expect(getCommand(id)?.title).toBe("Open drawing: Breadth First");
    expect(isCommandId(id)).toBe(true);
  });

  it("round-trips through [hotkeys] without an unknown-command problem", () => {
    const { values, problems } = configToPreferences({
      hotkeys: { [id]: ["cmd+alt+1"] },
    });
    expect(problems).toEqual([]);
    expect(values.hotkeys).toEqual({ [id]: ["Alt+Meta+1"] });
    const next = { ...DEFAULT_PREFERENCES, hotkeys: { [id]: ["Mod+Alt+1"] } };
    expect(preferencesToConfigChanges(DEFAULT_PREFERENCES, next)).toEqual([
      { key: `hotkeys.${id}`, value: ["Mod+Alt+1"] },
    ]);
  });

  it("binds a key and dispatches it to the prefix handler", () => {
    const open = vi.fn();
    const off = registerCommandPrefixHandler("drawing.open:", open);
    const overrides = { [id]: ["Mod+Alt+1"] };
    const command = getCommand(id)!;
    expect(effectiveKeys(command, overrides, "mac")).toEqual(["Mod+Alt+1"]);
    const keymap = buildKeymap(allCommands(overrides), overrides, "mac");
    const dispose = installCommandDispatcher(window, {
      platform: "mac",
      getKeymap: () => keymap,
      getContext: () =>
        readContext(document, {
          vaultOpen: true,
          drawingOpen: true,
          writable: true,
        }),
      getHandler: getRegisteredHandler,
    });
    const e = new KeyboardEvent("keydown", {
      code: "Digit1",
      key: "1",
      metaKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(e);
    dispose();
    off();
    expect(open).toHaveBeenCalledWith(path);
    expect(e.defaultPrevented).toBe(true);
  });

  it("exact handlers win and unbinding removes the prefix handler", () => {
    const exact = vi.fn();
    const prefix = vi.fn();
    const offExact = registerCommandHandlers({ [id]: exact });
    const offPrefix = registerCommandPrefixHandler("drawing.open:", prefix);
    void getRegisteredHandler(id)?.();
    expect(exact).toHaveBeenCalled();
    expect(prefix).not.toHaveBeenCalled();
    offExact();
    offPrefix();
    expect(getRegisteredHandler(id)).toBeUndefined();
  });

  it("lists bound drawings in the palette with their shortcut", () => {
    const overrides = { [id]: ["Mod+Alt+1"] };
    const run = vi.fn(() => true);
    const provider = createCommandsProvider({
      runner: { run, isAvailable: () => true, platform: "mac" },
      overrides: () => overrides,
    });
    const item = provider.items().find((i) => i.key === `command:${id}`);
    expect(item?.title).toBe("Open drawing: Breadth First");
    expect(item?.group).toBe("Links");
    expect(item?.shortcut).not.toBe("");
  });
});
