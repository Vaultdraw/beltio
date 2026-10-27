import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import { parseManifest } from "../../../../sdk/examples/testing/readManifest";
import plugin from "../src/main";

let p: TestPlugin | undefined;
afterEach(async () => {
  await p?.dispose();
  p = undefined;
});

/** The source plugin.toml (the build copies it to dist/, which a unit test does not need). */
const manifest = () => ({
  ...parseManifest(readFileSync(`${__dirname}/../plugin.toml`, "utf8")),
  mainBytes: 1,
  dir: __dirname,
});

describe("gallery plugin", () => {
  it("toggle opens the overlay and a second toggle closes it", async () => {
    p = await boot(manifest(), plugin);
    expect(p.overlay()).toBeNull();
    await p.run("toggle");
    expect(p.overlay()).not.toBeNull();
    await p.run("toggle");
    expect(p.overlay()).toBeNull();
  });

  it("declares the grid keys with focus scope and the folder menu item", async () => {
    const info = manifest();
    p = await boot(info, plugin);
    const close = info.contributes.commands.find((c) => c.id === "close");
    expect(close?.keys).toEqual(["Escape"]);
    expect(close?.when).toContain("galleryFocus");
    expect(p.menuItems("tree", "folder").map((m) => m.title)).toEqual([
      "Show as grid",
    ]);
  });
});
