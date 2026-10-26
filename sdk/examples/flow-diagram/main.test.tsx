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
    const ops = flowOps({ x: 0, y: 0 }) as any[];
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

  it("add a step: binds a new arrow to the flow's last box on the canvas", async () => {
    const p = await start();
    await insert(p);
    await p.run("extend");
    await p.flush();
    expect(p.scene.batches).toHaveLength(2);
    const els = p.scene.live() as any[];
    const boxes = els.filter((e) => e.type === "rectangle");
    expect(boxes).toHaveLength(5);
    const ship = boxes.find(
      (b) => b.customData?.["plugins.flow-diagram"]?.step === 3,
    );
    const next = boxes.find(
      (b) => b.customData?.["plugins.flow-diagram"]?.step === 4,
    );
    // The app's host kit keeps Excalidraw bindings; the SDK mock keeps ids.
    const startOf = (e: any) => e.startBinding?.elementId ?? e.startId;
    const endOf = (e: any) => e.endBinding?.elementId ?? e.endId;
    const arrow = els.find((e) => e.type === "arrow" && endOf(e) === next.id);
    expect(startOf(arrow)).toBe(ship.id);
    expect(ship.boundElements.map((b: any) => b.id)).toContain(arrow.id);
    expect(next.x).toBeGreaterThan(ship.x);
    // The longer flow is still one unit: every element shares the outer group.
    const outer = (e: any) => (e.groupIds ?? []).at(-1);
    expect(new Set(els.map(outer)).size).toBe(1);
  });

  it("add a step without a flow: a toast, nothing written", async () => {
    const p = await start();
    await p.run("extend");
    await p.flush();
    expect(p.scene.batches).toHaveLength(0);
    expect(p.toasts().join(" ")).toMatch(/Insert a flow first/);
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
