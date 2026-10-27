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

const manifest = () => ({
  ...parseManifest(readFileSync(`${__dirname}/../plugin.toml`, "utf8")),
  mainBytes: 1,
  dir: __dirname,
});

describe("mermaid plugin", () => {
  it("declares one method offered to AI apps", () => {
    const info = manifest();
    expect(info.contributes.methods?.map((m) => [m.id, m.mcp])).toEqual([
      ["to_drawing", true],
    ]);
    expect(info.contributes.commands ?? []).toEqual([]);
  });

  it("to_drawing refuses empty text before converting anything", async () => {
    p = await boot(manifest(), plugin);
    await expect(p.callMethod("to_drawing", { text: " " })).rejects.toThrow(
      /text is required/,
    );
  });

  it("to_drawing needs a path or an open drawing", async () => {
    p = await boot(manifest(), plugin);
    await expect(
      p.callMethod("to_drawing", { text: "graph TD; A-->B", path: 3 }),
    ).rejects.toThrow(/path must be a string/);
  });
});
