import { describe, expect, it, vi } from "vitest";

import { insertDiagram, mermaidFrom } from "../src/diagram";

import type { PluginContext, SceneOp } from "@vaultdraw/api";

describe("mermaidFrom", () => {
  it.each([
    ["```mermaid\nflowchart TD\n A-->B\n```", "flowchart TD\n A-->B"],
    ["Here you go:\n```\ngraph LR\nA-->B\n```\nEnjoy", "graph LR\nA-->B"],
    ["```MERMAID\nflowchart TD\nA-->B```", "flowchart TD\nA-->B"],
    ["flowchart TD\nA-->B", "flowchart TD\nA-->B"],
    ["", ""],
  ])("%j", (answer, expected) => {
    expect(mermaidFrom(answer)).toBe(expected);
  });
});

describe("insertDiagram", () => {
  const ops: SceneOp[] = [
    {
      op: "add",
      ref: "a",
      element: { type: "rectangle", x: 0, y: 0, width: 100, height: 50 },
    },
    {
      op: "add",
      element: {
        type: "arrow",
        x: 100,
        y: 25,
        width: 40,
        height: 0,
        start: { ref: "a" },
      } as any,
    },
  ];
  const fakeCtx = (convert: () => Promise<unknown>) => {
    const batch = vi.fn(async (o: readonly SceneOp[]) => ({
      ids: o.map((_, i) => `id${i}`),
      refs: {},
    }));
    const ctx = {
      diagrams: { mermaidToElements: vi.fn(convert) },
      scene: { viewportCenter: () => ({ x: 500, y: 300 }), batch },
    } as unknown as PluginContext;
    return { ctx, batch };
  };

  it("centres the diagram in the view and applies it in one batch", async () => {
    const { ctx, batch } = fakeCtx(async () => ({
      ops,
      width: 140,
      height: 50,
      skipped: 0,
    }));
    expect(
      await insertDiagram(ctx, "```mermaid\nflowchart TD\nA-->B\n```"),
    ).toBe(2);
    expect(batch).toHaveBeenCalledTimes(1);
    const sent = batch.mock.calls[0][0] as any[];
    expect(sent[0].element.x).toBe(430);
    expect(sent[0].element.y).toBe(275);
    expect(sent[1].element.start).toEqual({ ref: "a" });
  });

  it("a diagram the converter refuses is a plain message, nothing is drawn", async () => {
    const { ctx, batch } = fakeCtx(async () => {
      throw new Error("Parse error on line 1");
    });
    await expect(insertDiagram(ctx, "nonsense")).rejects.toThrow(
      /could not be drawn: Parse error/,
    );
    expect(batch).not.toHaveBeenCalled();
  });

  it("an empty answer is refused", async () => {
    const { ctx } = fakeCtx(async () => ({
      ops,
      width: 1,
      height: 1,
      skipped: 0,
    }));
    await expect(insertDiagram(ctx, "  ")).rejects.toThrow(/no diagram/);
  });
});
