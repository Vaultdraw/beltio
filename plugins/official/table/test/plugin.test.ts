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

const TSV = "Name\tQty\nApple\t3\nPear\t10";
const texts = (pl: TestPlugin) =>
  pl.scene.live().filter((e) => e.type === "text");

describe("table plugin", () => {
  it("ask: the text pastes, a toast offers a table, the click swaps it", async () => {
    p = await boot(manifest(), plugin);
    await p.setSetting("on_paste", "ask");
    p.scene.setElements([{ type: "text", x: 40, y: 60, text: TSV }]);
    p.scene.select(p.scene.live().map((e) => e.id));
    expect(await p.clipboard.paste(TSV)).toBe(false); // the editor pastes
    await new Promise((r) => setTimeout(r, 260));
    expect(p.clipboard.toastButtons()[0]?.label).toBe("Insert as table");
    expect(p.clipboard.clickToast("Insert as table")).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    const t = texts(p).map((e) => e.text);
    expect(t).toEqual(["Name", "Qty", "Apple", "3", "Pear", "10"]);
    expect(
      p.scene.live().some((e) => e.type === "text" && e.text === TSV),
    ).toBe(false);
  });

  it("always: the paste is handled and a table appears", async () => {
    p = await boot(manifest(), plugin);
    await p.setSetting("on_paste", "always");
    expect(await p.clipboard.paste("a,b\n1,2")).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(texts(p)).toHaveLength(4);
  });

  it("never, prose and single lines are left alone", async () => {
    p = await boot(manifest(), plugin);
    await p.setSetting("on_paste", "never");
    expect(await p.clipboard.paste(TSV)).toBe(false);
    await p.setSetting("on_paste", "always");
    expect(
      await p.clipboard.paste("Hello there.\nSecond line, with a comma."),
    ).toBe(false);
    expect(await p.clipboard.paste("a\tb")).toBe(false);
    expect(p.scene.live()).toHaveLength(0);
  });

  it("the command reads the clipboard", async () => {
    p = await boot(manifest(), plugin);
    p.clipboard.text = "| A | B |\n|---|---|\n| 1 | 2 |";
    await p.run("insert-from-clipboard");
    expect(texts(p).map((e) => e.text)).toEqual(["A", "B", "1", "2"]);
    p.clipboard.text = "not a table";
    await p.run("insert-from-clipboard");
    expect(p.toasts().some((t) => t.includes("not a table"))).toBe(true);
  });
});
