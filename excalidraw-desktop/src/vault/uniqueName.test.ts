import { describe, expect, it } from "vitest";

import { uniqueName } from "./uniqueName";

describe("uniqueName", () => {
  it.each([
    [[], "Untitled.excalidraw"],
    [["Untitled.excalidraw"], "Untitled 1.excalidraw"],
    [["untitled.excalidraw", "Untitled 1.excalidraw"], "Untitled 2.excalidraw"],
    [["Untitled 1.excalidraw"], "Untitled.excalidraw"],
    [["Other.excalidraw"], "Untitled.excalidraw"],
  ])("%j -> %s", (taken, expected) => {
    expect(uniqueName("Untitled", ".excalidraw", taken)).toBe(expected);
  });

  it("works for folders (no extension)", () => {
    expect(uniqueName("Untitled", "", ["Untitled"])).toBe("Untitled 1");
  });
});
