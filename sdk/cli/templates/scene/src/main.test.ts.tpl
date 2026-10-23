import { afterEach, describe, expect, it } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import plugin from "./main";

let p: TestPlugin | undefined;
afterEach(async () => {
  await p?.dispose();
  p = undefined;
});

const manifest = {
  id: "__ID__",
  name: "__NAME__",
  contributes: {
    commands: [{ id: "stamp", title: "__NAME__: stamp a note" }],
    settings: [
      { key: "color", type: "color", title: "Note colour", default: "#ffec99" },
    ],
  },
};

describe("__ID__", () => {
  it("adds one labelled box in a single batch", async () => {
    p = await boot(manifest as never, plugin);
    await p.run("stamp");
    expect(p.scene.batches).toHaveLength(1);
    const [box, label] = p.scene.live() as any[];
    expect(box.type).toBe("rectangle");
    expect(box.backgroundColor).toBe("#ffec99");
    expect(label.text).toBe("Note");
  });
});
