import { describe, expect, it } from "vitest";

import { newElementWith } from "@excalidraw/element";

import { projectScene, toSceneElement } from "./project";
import { makeElements } from "./testUtils";

describe("projectScene", () => {
  const els = makeElements(3);

  it("projects plain public fields only, skipping deleted", () => {
    const withDeleted = [els[0], newElementWith(els[1], { isDeleted: true })];
    const out = projectScene(withDeleted);
    expect(out).toHaveLength(1);
    expect(Object.keys(out[0]).sort()).toEqual(
      [
        "angle",
        "backgroundColor",
        "height",
        "id",
        "strokeColor",
        "type",
        "width",
        "x",
        "y",
      ].sort(),
    );
    expect(Object.isFrozen(out)).toBe(true);
  });

  it("includes text and maps unknown types to other", () => {
    expect(toSceneElement({ ...els[0], type: "iframe" } as never).type).toBe(
      "other",
    );
    expect(
      toSceneElement({ ...els[0], type: "text", text: "t" } as never).text,
    ).toBe("t");
  });

  it("returns the same reference for same array and version", () => {
    expect(projectScene(els)).toBe(projectScene(els));
  });

  it("projects anew when an element is mutated in place or the array changes", () => {
    const arr = makeElements(2);
    const a = projectScene(arr);
    (arr[0] as { version: number; x: number }).version += 1;
    (arr[0] as { x: number }).x = 999;
    const b = projectScene(arr);
    expect(b).not.toBe(a);
    expect(b[0].x).toBe(999);
    expect(projectScene([...arr])).not.toBe(b);
  });

  it("does not alias live elements", () => {
    const arr = makeElements(1);
    const out = projectScene(arr);
    (arr[0] as { x: number }).x = 5;
    expect(out[0].x).not.toBe(5);
  });
});
