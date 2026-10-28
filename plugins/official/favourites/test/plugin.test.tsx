import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import { appEvents } from "../../../../excalidraw-desktop/src/events/appEvents";

import { parseManifest } from "../../../../sdk/examples/testing/readManifest";
import plugin from "../src/main";

let p: TestPlugin | undefined;
afterEach(async () => {
  await p?.dispose();
  p = undefined;
});

const manifest = () => ({
  ...parseManifest(readFileSync(`${__dirname}/../plugin.toml`, "utf8")),
  mainBytes: 1,
  dir: __dirname,
});

const items = (t: TestPlugin) =>
  (t.vault.table().items ?? []) as { path: string }[];

describe("favourites plugin", () => {
  it("declares the panel, the toggle key, nine jump commands and the three menus", () => {
    const info = manifest();
    const ids = info.contributes.commands.map((c) => c.id);
    for (let n = 1; n <= 9; n++) {
      expect(ids).toContain(`open${n}`);
    }
    expect(info.contributes.panels.map((x) => x.id)).toEqual(["list"]);
    expect(
      info.contributes.commands.find((c) => c.id === "toggle")?.keys,
    ).toEqual(["Mod+Alt+J"]);
    expect((info.contributes.menus ?? []).map((m) => m.surface)).toEqual([
      "tree",
      "tab",
      "canvas",
    ]);
  });

  it("the tree menu adds a drawing to the vault table, again removes it", async () => {
    p = await boot(manifest(), plugin);
    await p.chooseMenuItem("tree", "Favourite: add or remove", {
      path: "Dir/A.excalidraw",
      kind: "drawing",
    });
    expect(items(p)).toEqual([{ path: "Dir/A.excalidraw" }]);
    await p.chooseMenuItem("tab", "Favourite: add or remove", {
      path: "B.excalidraw",
    });
    expect(items(p).map((x) => x.path)).toEqual([
      "Dir/A.excalidraw",
      "B.excalidraw",
    ]);
    await p.chooseMenuItem("tree", "Favourite: add or remove", {
      path: "Dir/A.excalidraw",
      kind: "drawing",
    });
    expect(items(p).map((x) => x.path)).toEqual(["B.excalidraw"]);
  });

  it("follows a rename and drops a deleted drawing", async () => {
    p = await boot(manifest(), plugin);
    await p.chooseMenuItem("tab", "Favourite: add or remove", {
      path: "A.excalidraw",
    });
    p.events.emit("drawing.renamed", {
      from: "A.excalidraw",
      to: "Z/A.excalidraw",
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(items(p)).toEqual([{ path: "Z/A.excalidraw" }]);
    p.events.emit("drawing.deleted", { path: "Z/A.excalidraw" });
    await new Promise((r) => setTimeout(r, 20));
    expect(items(p)).toEqual([]);
  });

  it("open2 opens the second favourite; a missing slot says so", async () => {
    p = await boot(manifest(), plugin);
    p.vault.seed({ "A.excalidraw": [], "B.excalidraw": [] });
    await p.chooseMenuItem("tab", "Favourite: add or remove", {
      path: "A.excalidraw",
    });
    await p.chooseMenuItem("tab", "Favourite: add or remove", {
      path: "B.excalidraw",
    });
    await p.run("open2");
    expect(p.workspace.opened().map((o) => o.path)).toEqual(["B.excalidraw"]);
    await p.run("open5");
    expect(p.toasts().some((t) => t.includes("No favourite 5"))).toBe(true);
  });

  it("the panel lists favourites in order and the keyboard reorders them", async () => {
    p = await boot(manifest(), plugin);
    await p.chooseMenuItem("tab", "Favourite: add or remove", {
      path: "A.excalidraw",
    });
    await p.chooseMenuItem("tab", "Favourite: add or remove", {
      path: "B.excalidraw",
    });
    const view = await p.openPanel("list");
    const rows = () =>
      view.getAllByTestId("favourite-row").map((r) => r.textContent);
    expect(rows()[0]).toContain("A");
    const first = view.getAllByRole("button", { name: /^A/ })[0];
    first.focus();
    first.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        altKey: true,
        bubbles: true,
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(items(p).map((x) => x.path)).toEqual([
      "B.excalidraw",
      "A.excalidraw",
    ]);
  });

  it("a rename made before the plugin loaded is followed once it does", async () => {
    appEvents.emit("vault.opened", { name: "v" });
    appEvents.emit("drawing.renamed", {
      from: "A.excalidraw",
      to: "Z/A.excalidraw",
    });
    // The file holds the old path, as it did before the rename.
    const seeded = {
      async activate(ctx: Parameters<typeof plugin.activate>[0]) {
        await ctx.vault.table.update([
          { key: "items", value: [{ path: "A.excalidraw" }] },
        ]);
        return plugin.activate(ctx);
      },
    };
    p = await boot(manifest(), seeded);
    p.vault.seed({ "Z/A.excalidraw": [] });
    await p.run("open1");
    expect(p.workspace.opened().map((o) => o.path)).toEqual(["Z/A.excalidraw"]);
    expect(items(p)).toEqual([{ path: "Z/A.excalidraw" }]);
  });
});
