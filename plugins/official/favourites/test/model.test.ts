import { describe, expect, it } from "vitest";

import {
  defaultLabel,
  dropPath,
  labelOf,
  move,
  parseItems,
  relabel,
  removeAt,
  renamePath,
  serialize,
  toggle,
} from "../src/model";

const a = { path: "A.excalidraw" };
const b = { path: "Dir/B.excalidraw", label: "Bee" };
const c = { path: "Dir/C.md" };

describe("favourites model", () => {
  it("parses hand-edited rows and drops junk and duplicates", () => {
    expect(
      parseItems([
        { path: " A.excalidraw " },
        { path: "A.excalidraw" },
        { path: "" },
        { label: "no path" },
        "text",
        { path: "A.excalidraw", element: "e1", label: "  Frame  " },
        { path: 5 },
      ]),
    ).toEqual([
      { path: "A.excalidraw" },
      { path: "A.excalidraw", element: "e1", label: "Frame" },
    ]);
    expect(parseItems(undefined)).toEqual([]);
  });

  it("serialize keeps only the three flat fields", () => {
    expect(serialize([{ path: "A", label: "", element: undefined }])).toEqual([
      { path: "A" },
    ]);
  });

  it("toggle adds at the end and removes when listed; an element is its own entry", () => {
    let r = toggle([a], "B", undefined);
    expect(r).toEqual({ items: [a, { path: "B" }], added: true });
    r = toggle(r.items, "B");
    expect(r.items).toEqual([a]);
    expect(r.added).toBe(false);
    r = toggle([a], "A.excalidraw", "e1", "Box");
    expect(r.items).toEqual([
      a,
      { path: "A.excalidraw", element: "e1", label: "Box" },
    ]);
  });

  it("moves and clamps", () => {
    expect(move([a, b, c], 0, 2)).toEqual([b, c, a]);
    expect(move([a, b, c], 2, -5)).toEqual([c, a, b]);
    expect(move([a, b, c], 9, 0)).toEqual([a, b, c]);
  });

  it("relabels, clears the label, removes", () => {
    expect(relabel([a, b], 0, " New ")[0]).toEqual({
      path: "A.excalidraw",
      label: "New",
    });
    expect(relabel([a, b], 1, "")[1]).toEqual({ path: "Dir/B.excalidraw" });
    expect(removeAt([a, b], 0)).toEqual([b]);
  });

  it("follows a file rename and a folder move; delete drops what was inside", () => {
    expect(renamePath([a, b, c], "A.excalidraw", "Z.excalidraw")[0].path).toBe(
      "Z.excalidraw",
    );
    expect(
      renamePath([a, b, c], "Dir", "Moved/Dir").map((f) => f.path),
    ).toEqual(["A.excalidraw", "Moved/Dir/B.excalidraw", "Moved/Dir/C.md"]);
    expect(renamePath([{ path: "Dirty/x" }], "Dir", "Q")[0].path).toBe(
      "Dirty/x",
    );
    expect(dropPath([a, b, c], "Dir")).toEqual([a]);
  });

  it("labels default to the file name", () => {
    expect(defaultLabel("X/Plan.excalidraw")).toBe("Plan");
    expect(defaultLabel("X/Note.excalidraw.md")).toBe("Note");
    expect(labelOf(b)).toBe("Bee");
    expect(labelOf({ path: "P.excalidraw", element: "e" })).toBe("P (element)");
  });
});
