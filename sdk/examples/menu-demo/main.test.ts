import { afterEach, describe, expect, it, vi } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import { readExample } from "../testing/readManifest";

import plugin from "./main.js";

let p: TestPlugin | undefined;
afterEach(async () => {
  await p?.dispose();
  p = undefined;
});

describe("menu-demo", () => {
  it("declares its items and loads no code until one is chosen", async () => {
    const activate = vi.spyOn(plugin, "activate");
    p = await boot(readExample("menu-demo"), plugin);
    expect(p.menuItems("tree", "note").map((m) => m.title)).toEqual([
      "Where was I chosen?",
    ]);
    expect(p.menuItems("tree", "folder")).toEqual([]);
    expect(p.menuItems("tab").map((m) => m.title)).toEqual([
      "Menu demo: where was I chosen?",
    ]);
    expect(p.menuItems("canvas")).toHaveLength(1);
    expect(activate).not.toHaveBeenCalled();
  });

  it("the command reads where the item was chosen", async () => {
    p = await boot(readExample("menu-demo"), plugin);
    await p.chooseMenuItem("tree", "Where was I chosen?", {
      path: "a/b.md",
      kind: "note",
    });
    await p.chooseMenuItem("canvas", "Menu demo: where was I chosen?", {
      path: "d.excalidraw",
      at: { x: 10.4, y: 20 },
    });
    expect(p.toasts()).toEqual([
      "Menu demo: tree: a/b.md",
      "Menu demo: canvas: d.excalidraw at 10,20",
    ]);
  });

  it("from the palette there is no target", async () => {
    p = await boot(readExample("menu-demo"), plugin);
    await p.run("where");
    expect(p.toasts()).toEqual(["Menu demo: Not from a menu (palette or key)"]);
  });
});
