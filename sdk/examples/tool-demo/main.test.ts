import { afterEach, describe, expect, it, vi } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import { readExample } from "../testing/readManifest";

import plugin from "./main.js";

let p: TestPlugin | undefined;
afterEach(async () => {
  await p?.dispose();
  p = undefined;
});

describe("tool-demo", () => {
  it("declares its tool and loads no code until it is used", async () => {
    const activate = vi.spyOn(plugin, "activate");
    p = await boot(readExample("tool-demo"), plugin);
    expect(p.info.contributes.tools?.map((t) => t.id)).toEqual(["box"]);
    expect(activate).not.toHaveBeenCalled();
  });

  it("a drag draws one box", async () => {
    p = await boot(readExample("tool-demo"), plugin);
    const tool = p.tool("box");
    await tool.down(10, 20);
    await tool.up(110, 70);
    expect(p.scene.live()).toMatchObject([
      { type: "rectangle", x: 10, y: 20, width: 100, height: 50 },
    ]);
  });

  it("a click or a cancelled drag draws nothing", async () => {
    p = await boot(readExample("tool-demo"), plugin);
    const tool = p.tool("box");
    await tool.down(10, 20);
    await tool.up(11, 21);
    await tool.down(10, 20);
    await tool.cancel();
    await tool.up(200, 200);
    expect(p.scene.live()).toEqual([]);
  });
});
