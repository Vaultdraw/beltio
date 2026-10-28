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

const frames = [
  {
    type: "frame" as const,
    id: "f1",
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    name: "Intro",
  },
  { type: "frame" as const, id: "f2", x: 500, y: 0, width: 400, height: 300 },
  { type: "frame" as const, id: "f3", x: 1000, y: 0, width: 400, height: 300 },
];

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("frames plugin", () => {
  it("declares the panel, the presentation keys and the three settings", () => {
    const info = manifest();
    expect(info.contributes.panels.map((x) => x.id)).toEqual(["list"]);
    const keys = (id: string) =>
      info.contributes.commands.find((c) => c.id === id)?.keys;
    expect(keys("next")).toEqual([
      "ArrowRight",
      "ArrowDown",
      "Space",
      "PageDown",
    ]);
    expect(keys("laser")).toEqual(["L"]);
    expect(
      info.contributes.commands.find((c) => c.id === "next")?.when,
    ).toEqual(["present.active"]);
    expect((info.contributes.settings ?? []).map((s) => s.key)).toEqual([
      "transition",
      "background",
      "show_progress",
    ]);
  });

  it("presenting with no frames says so and starts nothing", async () => {
    p = await boot(manifest(), plugin);
    await p.run("present");
    expect(p.present()).toBeNull();
    expect(p.toasts().join(" ")).toContain("No frames");
  });

  it("starts from the selected frame, steps with next and prev, and ends with exit", async () => {
    p = await boot(manifest(), plugin);
    p.scene.setElements(frames);
    p.scene.select(["f2"]);
    await p.run("present");
    await tick();
    expect(p.present()).not.toBeNull();
    await new Promise((r) => setTimeout(r, 120));
    expect(p.scene.fittedTo().at(-1)).toMatchObject({
      id: "f2",
      animate: false,
    });
    await p.run("next");
    expect(p.scene.fittedTo().at(-1)?.id).toBe("f3");
    await p.run("next"); // the last slide stays
    expect(p.scene.fittedTo().at(-1)?.id).toBe("f3");
    await p.run("prev");
    await p.run("first");
    expect(p.scene.fittedTo().at(-1)?.id).toBe("f1");
    await p.run("laser");
    expect(p.present()?.laser).toBe(true);
    await p.run("exit");
    expect(p.present()).toBeNull();
    expect(p.overlay()).toBeNull();
  });

  it("the host ending the session (Escape) closes the strip", async () => {
    p = await boot(manifest(), plugin);
    p.scene.setElements(frames);
    await p.run("present-first");
    await tick();
    expect(p.overlay()).not.toBeNull();
    p.present()?.end();
    expect(p.overlay()).toBeNull();
  });

  it("move-down saves the order on the frames in one batch", async () => {
    p = await boot(manifest(), plugin);
    p.scene.setElements(frames);
    p.scene.select(["f1"]);
    await p.run("move-down");
    const batch = p.scene.batches.at(-1);
    expect(batch).toBeDefined();
    const order = (id: string) =>
      (
        batch!.elements.find((e) => e.id === id) as {
          customData?: Record<string, { order: number }>;
        }
      ).customData?.frames?.order;
    expect(order("f1")).toBe(1);
    expect(order("f2")).toBe(0);
  });

  it("the panel lists the frames in order and Present starts the show", async () => {
    p = await boot(manifest(), plugin);
    p.scene.setElements(frames);
    await p.openPanel("list");
    await p.flush();
    const rows = [...document.querySelectorAll(".vd-frames-label")].map(
      (n) => n.textContent,
    );
    expect(rows).toEqual(["Intro", "Frame 2", "Frame 3"]);
    (
      document.querySelector("[data-testid=frames-present]") as HTMLElement
    ).click();
    await tick();
    expect(p.present()).not.toBeNull();
  });
});
