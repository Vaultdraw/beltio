import { readFileSync } from "node:fs";

import { afterEach, expect, it } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import { parseManifest } from "../../../../sdk/examples/testing/readManifest";
import { MAX_FAVOURITES } from "../src/model";
import plugin from "../src/main";

let p: TestPlugin | undefined;
afterEach(async () => {
  await p?.dispose();
  p = undefined;
});

// Bug hunt round 5: with a full list, adding says "Removed X from favourites" although nothing was removed.
it("a full list refuses a new favourite and does not say it removed it", async () => {
  const info = {
    ...parseManifest(readFileSync(`${__dirname}/../plugin.toml`, "utf8")),
    mainBytes: 1,
    dir: __dirname,
  };
  p = await boot(info, plugin);
  for (let i = 0; i < MAX_FAVOURITES; i++) {
    await p.chooseMenuItem("tab", "Favourite: add or remove", {
      path: `D${i}.excalidraw`,
    });
  }
  await p.chooseMenuItem("tab", "Favourite: add or remove", {
    path: "New.excalidraw",
  });
  const said = p.toasts().filter((t) => t.includes("New"));
  expect(said.some((t) => t.includes("Removed"))).toBe(false);
}, 60000);
