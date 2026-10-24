import { afterEach, describe, expect, it } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import { readExample } from "../testing/readManifest";

import plugin from "./main.js";

let t: TestPlugin | undefined;
afterEach(async () => {
  await t?.dispose();
  t = undefined;
});

const start = async () => {
  t = await boot(readExample("text-import"), plugin);
  return t;
};

describe("text-import", () => {
  it("declares one importer for .txt", () => {
    expect(readExample("text-import").contributes.importers).toEqual([
      { id: "txt", title: "Plain text", extensions: ["txt"] },
    ]);
  });

  it("writes one text element at the drop point in one batch", async () => {
    const p = await start();
    await p.import("hello.txt", "Hello from a file\n", { x: 40, y: 60 });
    expect(p.scene.batches).toHaveLength(1);
    expect(p.scene.live()).toMatchObject([
      { type: "text", x: 40, y: 60, text: "Hello from a file" },
    ]);
  });

  it("an empty file: toast, nothing written", async () => {
    const p = await start();
    expect(await p.import("e.txt", " \n")).toBeNull();
    expect(p.toasts()).toEqual(["Text import: e.txt is empty"]);
    expect(p.scene.batches).toHaveLength(0);
  });

  it("another extension has no importer", async () => {
    const p = await start();
    await expect(p.import("a.md", "x")).rejects.toThrow(/no importer/);
  });
});
