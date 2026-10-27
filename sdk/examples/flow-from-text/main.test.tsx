import { afterEach, describe, expect, it } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import { readExample } from "../testing/readManifest";

import plugin, { flowOps, parseFlow } from "./main.js";

let t: TestPlugin | undefined;
afterEach(async () => {
  await t?.dispose();
  t = undefined;
});

describe("flow-from-text", () => {
  it("parseFlow reads chains, labels and the direction", () => {
    const f = parseFlow("graph LR; A[Idea] --> B(Draft) --> C\nA --> C");
    expect(f.dir).toBe("LR");
    expect(f.nodes.map((n) => n.label)).toEqual(["Idea", "Draft", "C"]);
    expect(f.edges).toEqual([
      ["A", "B"],
      ["B", "C"],
      ["A", "C"],
    ]);
  });

  it("parseFlow refuses empty text, junk and a flow that is too big", () => {
    expect(() => parseFlow("")).toThrow(/non-empty/);
    expect(() => parseFlow("A --> ???")).toThrow(/cannot read/);
    expect(() => parseFlow("graph TD")).toThrow(/no nodes/);
    const big = Array.from({ length: 51 }, (_, i) => `n${i}`).join(" --> ");
    expect(() => parseFlow(big)).toThrow(/too many/);
  });

  it("flowOps puts each layer one step further along the direction", () => {
    const ops = flowOps(parseFlow("graph LR; A --> B --> C"));
    const xs = ops
      .filter((o: any) => o.element.type === "rectangle")
      .map((o: any) => o.element.x);
    expect(xs).toEqual([0, 210, 420]);
    expect(ops.filter((o: any) => o.element.type === "arrow")).toHaveLength(2);
    // A cycle terminates.
    expect(() => flowOps(parseFlow("A --> B --> A"))).not.toThrow();
  });

  it("the draw method draws the flow in one batch and answers with counts", async () => {
    t = await boot(readExample("flow-from-text"), plugin);
    const r = await t.callMethod("draw", { text: "graph TD; A --> B --> C" });
    expect(r).toEqual({ nodes: 3, arrows: 2 });
    expect(t.scene.batches).toHaveLength(1);
    expect(await t.callMethod("count")).toMatchObject({
      byType: { rectangle: 3, arrow: 2 },
    });
    await expect(t.callMethod("draw", { text: "" })).rejects.toThrow(
      /non-empty/,
    );
    await expect(t.callMethod("nope")).rejects.toThrow(/no method/);
  });
});
