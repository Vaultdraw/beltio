import { afterEach, describe, expect, it, vi } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import { readExample } from "../testing/readManifest";

import plugin from "./main.js";

let p: TestPlugin | undefined;
afterEach(async () => {
  await p?.dispose();
  p = undefined;
});

describe("toolbar-demo", () => {
  it("declares its button and loads no code until it runs", async () => {
    const activate = vi.spyOn(plugin, "activate");
    p = await boot(readExample("toolbar-demo"), plugin);
    expect(p.info.contributes.toolbar).toEqual([
      {
        command: "count",
        title: "Count clicks",
        icon: "M12 5v14M5 12h14",
        priority: 0,
      },
    ]);
    expect(activate).not.toHaveBeenCalled();
  });

  it("the command counts", async () => {
    p = await boot(readExample("toolbar-demo"), plugin);
    await p.run("count");
    await p.run("count");
    expect(p.toasts()).toEqual([
      "Toolbar demo: Clicked 1 time",
      "Toolbar demo: Clicked 2 times",
    ]);
  });
});
