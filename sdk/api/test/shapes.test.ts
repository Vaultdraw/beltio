import { describe, expect, it } from "vitest";

import {
  renderShape,
  shapeRect,
  SHAPE_MAX_SVG_BYTES,
  updateOps,
} from "../shared/shapes";

const decl = { id: "s", title: "S", width: 100, height: 60 };
const ok = { render: () => `<svg xmlns="http://www.w3.org/2000/svg"/>` };

describe("shape rules", () => {
  it("renders SVG bytes and refuses anything else", () => {
    expect(renderShape("s", ok, {}, decl).byteLength).toBeGreaterThan(10);
    expect(() =>
      renderShape("s", { render: () => "<div/>" }, {}, decl),
    ).toThrow(/starts with <svg/);
    expect(() =>
      renderShape("s", { render: () => 5 as never }, {}, decl),
    ).toThrow(/starts with <svg/);
    expect(() =>
      renderShape(
        "s",
        { render: () => `<svg>${"x".repeat(SHAPE_MAX_SVG_BYTES)}</svg>` },
        {},
        decl,
      ),
    ).toThrow(/the most is/);
  });

  it("centres a new shape and takes overrides", () => {
    expect(shapeRect(decl, { x: 100, y: 100 })).toEqual({
      x: 50,
      y: 70,
      width: 100,
      height: 60,
    });
    expect(shapeRect(decl, { x: 0, y: 0 }, { x: 1, y: 2, width: 10 })).toEqual({
      x: 1,
      y: 2,
      width: 10,
      height: 60,
    });
    expect(() => shapeRect(decl, { x: 0, y: 0 }, { width: 0 })).toThrow();
    expect(() => shapeRect(decl, { x: 0, y: 0 }, { x: NaN })).toThrow(/finite/);
  });

  it("updates only shapes of the plugin, in place", () => {
    const scene = (data: unknown, type = "image") => ({
      get: () => [{ id: "e", type, x: 5, y: 6, width: 7, height: 8 }] as never,
      dataOf: () => data as never,
    });
    const defs = (s: string) => (s === "s" ? { def: ok } : undefined);
    const ops = updateOps(
      scene({ shape: "s", props: {} }),
      "e",
      { a: 1 },
      defs,
    );
    // One in-place update (API 0.25.0): the element keeps its id, only picture and data change.
    expect(ops.map((o) => o.op)).toEqual(["update"]);
    expect(ops[0]).toMatchObject({
      op: "update",
      id: "e",
      props: { data: { shape: "s", props: { a: 1 } } },
    });
    expect((ops[0] as { props: { image: unknown } }).props.image).toMatchObject(
      { mime: "image/svg+xml" },
    );
    expect(() => updateOps(scene(undefined), "e", {}, defs)).toThrow(
      /not a shape/,
    );
    expect(() => updateOps(scene({ shape: "other" }), "e", {}, defs)).toThrow(
      /not a shape/,
    );
    expect(() =>
      updateOps(scene({ shape: "s" }, "rectangle"), "e", {}, defs),
    ).toThrow(/not a shape/);
  });
});
