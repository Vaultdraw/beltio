import { afterEach, describe, expect, it } from "vitest";

import { boot } from "../testing";

import type { TestPlugin } from "../testing";

let p: TestPlugin | undefined;
afterEach(async () => {
  await p?.dispose();
  p = undefined;
});

const manifest = {
  id: "mn",
  contributes: {
    commands: [{ id: "go", title: "Go" }],
    menus: [
      { surface: "tree" as const, command: "go", kinds: ["note" as const] },
      { surface: "tab" as const, command: "go", title: "Tab go" },
    ],
  },
};

describe("mock host: ctx.menus", () => {
  it("lists the items by surface and kind, and a chosen item sets the target for its command only", async () => {
    const seen: unknown[] = [];
    p = await boot(manifest, {
      activate(ctx) {
        ctx.commands.register("go", () => {
          seen.push(ctx.menus.target());
        });
      },
    });
    expect(p.menuItems("tree", "note")).toEqual([
      { title: "Go", command: "go" },
    ]);
    expect(p.menuItems("tree", "folder")).toEqual([]);
    expect(p.menuItems("tab")).toEqual([{ title: "Tab go", command: "go" }]);
    await p.chooseMenuItem("tab", "Tab go", { path: "a.excalidraw" });
    await p.run("go");
    expect(seen).toEqual([{ surface: "tab", path: "a.excalidraw" }, null]);
    await expect(p.chooseMenuItem("canvas", "x")).rejects.toThrow(
      /no canvas menu item/,
    );
  });
});
