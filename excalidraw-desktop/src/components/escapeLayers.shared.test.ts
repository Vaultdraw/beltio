import { describe, expect, it, vi } from "vitest";

/** Plugin bundles carry their own copy of escapeLayers; the stack must still be one per window. */
describe("escape stack across bundles", () => {
  it("a second copy of the module sees the first copy's layers", async () => {
    const a = await import("./escapeLayers");
    const layer = a.pushEscapeLayer();
    vi.resetModules();
    const b = await import("./escapeLayers");
    expect(b).not.toBe(a);
    expect(b.escapeDepth()).toBe(1);
    const top = b.pushEscapeLayer();
    expect(layer.isTop()).toBe(false);
    top.pop();
    expect(layer.isTop()).toBe(true);
    layer.pop();
    expect(a.escapeDepth()).toBe(0);
  });
});
