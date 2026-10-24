import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import { readExample } from "../testing/readManifest";

import plugin, { flowOps } from "./main.js";

let t: TestPlugin | undefined;
afterEach(async () => {
  await t?.dispose();
  t = undefined;
});

const start = async () => {
  t = await boot(readExample("flow-diagram"), plugin);
  return t;
};

/** Runs the command and returns what the scene holds after it. */
const insert = async (p: TestPlugin) => {
  await p.run("insert");
  await p.flush();
  return p.scene.live() as any[];
};

describe("flow-diagram", () => {
  it("flowOps: four boxes with refs, three bound arrows and one group", () => {
    const ops = flowOps({ x: 0, y: 0 });
    expect(ops.filter((o) => o.op === "add")).toHaveLength(7);
    const group = ops.find((o) => o.op === "group")!;
    expect(group.ids).toHaveLength(7);
    const arrow = ops.find(
      (o) => o.op === "add" && o.element.type === "arrow",
    )!;
    expect(arrow.element.start).toEqual({ ref: "step0" });
    expect(arrow.element.end).toEqual({ ref: "step1" });
  });

  it("the command draws the flow in ONE batch: labelled boxes, grouped, with data", async () => {
    const p = await start();
    const els = await insert(p);
    expect(p.scene.batches).toHaveLength(1);
    const boxes = els.filter((e) => e.type === "rectangle");
    const arrows = els.filter((e) => e.type === "arrow");
    expect(boxes).toHaveLength(4);
    expect(arrows).toHaveLength(3);
    expect(els.filter((e) => e.type === "text").map((e) => e.text)).toEqual([
      "Idea",
      "Draft",
      "Review",
      "Ship",
    ]);
    const groups = new Set(els.map((e) => (e.groupIds ?? []).join(",")));
    expect(groups.size).toBe(1);
    expect([...groups][0]).not.toBe("");
    expect(boxes.map((b) => b.customData?.["plugins.flow-diagram"])).toEqual(
      [0, 1, 2, 3].map((step) => ({ step })),
    );
  });

  it("the panel's button does the same", async () => {
    const p = await start();
    await p.openPanel("flow");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Insert flow" }));
    });
    await p.flush();
    expect(p.scene.batches).toHaveLength(1);
    expect(p.scene.live().filter((e) => e.type === "arrow")).toHaveLength(3);
  });

  it("without a drawing: a toast, nothing written", async () => {
    const p = await start();
    p.scene.switchTo(null);
    await insert(p);
    expect(p.scene.batches).toHaveLength(0);
    expect(p.toasts().join(" ")).toMatch(/Open a drawing/);
  });

  it("read-only drawing: a toast, nothing written", async () => {
    const p = await start();
    p.scene.readOnly(true);
    await insert(p);
    expect(p.scene.batches).toHaveLength(0);
    expect(p.toasts().join(" ")).toMatch(/read-only/);
  });
});
