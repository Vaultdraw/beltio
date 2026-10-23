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
  t = await boot(readExample("stamp"), plugin);
  return t;
};

describe("stamp", () => {
  it("note uses the default colour, one batch, one labelled box", async () => {
    const p = await start();
    await p.run("note");
    expect((p.scene.live()[0] as any).backgroundColor).toBe("#ffec99");
  });

  it("note: one batch with a labelled rectangle in the setting's colour", async () => {
    const p = await start();
    await p.setSetting("color", "#a5d8ff");
    await p.run("note");
    expect(p.scene.batches).toHaveLength(1);
    const els = p.scene.live();
    expect(els.map((e) => e.type)).toEqual(["rectangle", "text"]);
    const [box, label] = els as any[];
    expect(box.backgroundColor).toBe("#a5d8ff");
    expect(label.text).toBe("Note");
    expect(label.containerId).toBe(box.id);
    await p.setSetting("color", "#ffec99"); // settings outlive the kit
  });

  it("flow: ONE batch with three labelled boxes and two arrows, left to right", async () => {
    const p = await start();
    await p.run("flow");
    expect(p.scene.batches).toHaveLength(1);
    const els = p.scene.live() as any[];
    expect(els.filter((e) => e.type === "rectangle")).toHaveLength(3);
    expect(els.filter((e) => e.type === "arrow")).toHaveLength(2);
    expect(
      els
        .filter((e) => e.type === "text")
        .map((e) => e.text)
        .sort(),
    ).toEqual(["Done", "Start", "Step"]);
    const xs = els.filter((e) => e.type === "rectangle").map((e) => e.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(els.map((e) => e.id)).size).toBe(els.length);
  });

  it("without a drawing: toast, nothing thrown, nothing written", async () => {
    const p = await start();
    p.scene.switchTo(null);
    await p.run("flow");
    await p.run("note");
    expect(p.toasts()).toEqual(["Stamp: Open an editable drawing first"]);
    expect(p.scene.batches).toHaveLength(0);
    expect(
      p
        .log()
        .filter(
          (l) => l.level === "error" && !l.text.startsWith("scene.batch:"),
        ),
    ).toEqual([]);
  });

  it("read-only drawing: toast instead of an error", async () => {
    const p = await start();
    p.scene.readOnly(true);
    await p.run("note");
    expect(p.toasts()).toEqual(["Stamp: Open an editable drawing first"]);
    expect(p.scene.batches).toHaveLength(0);
  });

  it("disable leaves nothing behind", async () => {
    const p = await start();
    await p.run("note");
    await p.disable();
    expect(p.timers()).toBe(0);
  });
});
