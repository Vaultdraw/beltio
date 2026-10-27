import { afterEach, describe, expect, it, vi } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import { readExample } from "../testing/readManifest";

import plugin from "./main.js";

let p: TestPlugin | undefined;
afterEach(async () => {
  await p?.dispose();
  p = undefined;
});

describe("shape-demo", () => {
  it("declares its shape and loads no code until it is inserted", async () => {
    const activate = vi.spyOn(plugin, "activate");
    p = await boot(readExample("shape-demo"), plugin);
    expect(p.info.contributes.shapes).toMatchObject([
      { id: "badge", width: 120, height: 120 },
    ]);
    expect(activate).not.toHaveBeenCalled();
  });

  it("inserts a badge: an SVG image with the props as plugin data", async () => {
    p = await boot(readExample("shape-demo"), plugin);
    await p.insertShape("badge");
    const els = p.scene.live();
    expect(els).toHaveLength(1);
    expect(els[0]).toMatchObject({ type: "image", width: 120, height: 120 });
    expect(p.scene.batches).toHaveLength(1);
  });

  it("draws every badge again with new props", async () => {
    p = await boot(readExample("shape-demo"), plugin);
    await p.insertShape("badge");
    await p.run("done");
    const els = p.scene.live();
    expect(els).toHaveLength(1);
    expect(els[0]).toMatchObject({ type: "image", width: 120, height: 120 });
  });
});
