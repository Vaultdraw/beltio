import { describe, expect, it } from "vitest";

import { rect } from "../page/testElements";

import { currentDrawingBytes } from "./drawingBytes";

describe("currentDrawingBytes", () => {
  it("counts live elements and file data URLs", () => {
    const live = rect(0, 0);
    const gone = rect(0, 0, 10, 10, { isDeleted: true });
    const files = { a: { dataURL: "x".repeat(100) } } as any;
    const bytes = currentDrawingBytes([live, gone], files);
    expect(bytes).toBe(JSON.stringify([live]).length + 100);
    expect(currentDrawingBytes([], null)).toBe(2);
  });
});
