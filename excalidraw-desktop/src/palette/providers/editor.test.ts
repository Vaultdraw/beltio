import { describe, expect, it, vi } from "vitest";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { createEditorProvider } from "./editor";

const cmd = (id: string, available = true, shortcut: string | null = null) => ({
  id,
  label: id,
  keywords: [],
  category: "Elements",
  shortcut,
  available,
  perform: vi.fn(),
});

const apiWith = (items: ReturnType<typeof cmd>[]) =>
  ({
    isDestroyed: false,
    getCommandPaletteItems: () => items,
  } as unknown as ExcalidrawImperativeAPI);

describe("editor provider", () => {
  it("keeps available, non-excluded items with our shortcut notation", () => {
    const align = cmd("copyAsPng", true, "Cmd+Shift+Left");
    const api = apiWith([
      align,
      cmd("group", false),
      cmd("toggleTheme"),
      cmd("saveFileToDisk"),
      cmd("library"),
    ]);
    const provider = createEditorProvider(() => api, {
      platform: "mac",
      disabled: () => false,
    });
    const items = provider.items();
    expect(items.map((i) => i.key)).toEqual(["editor:copyAsPng"]);
    expect(items[0].group).toBe("Elements");
    expect(items[0].shortcut).toBe("⇧⌘←");
    void items[0].run();
    expect(align.perform).toHaveBeenCalled();
  });

  it("shows the user's key for actions that are canvas.* commands", () => {
    const api = apiWith([
      cmd("group", true, "Cmd+G"),
      cmd("cut", true, "Cmd+X"),
    ]);
    const items = (overrides: Record<string, string[]>) =>
      createEditorProvider(() => api, {
        platform: "mac",
        disabled: () => false,
        overrides: () => overrides,
      })
        .items()
        .map((i) => i.shortcut);
    expect(items({})).toEqual(["⌘G", "⌘X"]);
    expect(items({ "canvas.group": ["Alt+G"] })).toEqual(["⌥G", "⌘X"]);
    expect(items({ "canvas.group": [] })).toEqual(["", "⌘X"]);
  });

  it("is empty without an editor or while disabled", () => {
    const api = apiWith([cmd("zoomIn")]);
    expect(
      createEditorProvider(() => null, {
        platform: "mac",
        disabled: () => false,
      }).items(),
    ).toEqual([]);
    expect(
      createEditorProvider(() => api, {
        platform: "mac",
        disabled: () => true,
      }).items(),
    ).toEqual([]);
  });
});
