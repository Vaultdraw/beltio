/**
 * Navigator tree drag-and-drop rules (QA scope).
 *
 * Tests the pure production helpers in `treeStore.ts` that the pointer-based
 * tree drag relies on: `resolveDropFolder` (which folder a hovered row
 * accepts drops for) and `checkTreeDrop` (whether a drop is allowed, and why
 * not).
 */
import { describe, expect, it } from "vitest";

import { checkTreeDrop, resolveDropFolder } from "../vault/treeStore";

type Source = { path: string; name: string; kind: "folder" | "drawing" };

const drawing = (path: string): Source => ({
  path,
  name: path.split("/").pop()!,
  kind: "drawing",
});
const folder = (path: string): Source => ({
  path,
  name: path.split("/").pop()!,
  kind: "folder",
});

describe("resolveDropFolder", () => {
  it("a folder row targets the folder itself", () => {
    expect(resolveDropFolder("DSA", "folder")).toBe("DSA");
    expect(resolveDropFolder("DSA/Dynamic Programming", "folder")).toBe(
      "DSA/Dynamic Programming",
    );
  });

  it("a drawing row targets its parent folder", () => {
    expect(resolveDropFolder("DSA/Graphs.excalidraw", "drawing")).toBe("DSA");
    expect(
      resolveDropFolder(
        "DSA/Dynamic Programming/01 Introduction.excalidraw",
        "drawing",
      ),
    ).toBe("DSA/Dynamic Programming");
  });

  it("a top-level drawing row targets the vault root", () => {
    expect(resolveDropFolder("Notes.excalidraw", "drawing")).toBe("");
  });
});

describe("checkTreeDrop allowed moves", () => {
  it("drawing into another folder", () => {
    expect(
      checkTreeDrop(
        drawing("DSA/Graphs.excalidraw"),
        "DSA/Dynamic Programming",
      ),
    ).toEqual({ allowed: true });
  });

  it("folder into a sibling folder", () => {
    expect(checkTreeDrop(folder("DSA/Dynamic Programming"), "Archive")).toEqual(
      { allowed: true },
    );
  });

  it("nested drawing and folder into the vault root", () => {
    expect(checkTreeDrop(drawing("DSA/Graphs.excalidraw"), "")).toEqual({
      allowed: true,
    });
    expect(checkTreeDrop(folder("DSA/Dynamic Programming"), "")).toEqual({
      allowed: true,
    });
  });

  it("top-level drawing into a folder", () => {
    expect(checkTreeDrop(drawing("Notes.excalidraw"), "DSA")).toEqual({
      allowed: true,
    });
  });

  it("a prefix-named sibling is not treated as a descendant (DSA -> DSA2)", () => {
    expect(checkTreeDrop(folder("DSA"), "DSA2")).toEqual({ allowed: true });
    expect(checkTreeDrop(folder("DSA"), "DSA2/Sub")).toEqual({ allowed: true });
    expect(checkTreeDrop(folder("DSA2"), "DSA")).toEqual({ allowed: true });
  });

  it("no clash when the target holds only other names", () => {
    expect(
      checkTreeDrop(drawing("DSA/Graphs.excalidraw"), "Archive", {
        existingNames: ["Trees.excalidraw", "Graphs", "graphs.excalidraw2"],
      }),
    ).toEqual({ allowed: true });
  });

  it("an empty existing-name list and readOnly=false do not block", () => {
    expect(
      checkTreeDrop(drawing("DSA/Graphs.excalidraw"), "Archive", {
        readOnly: false,
        existingNames: new Set<string>(),
      }),
    ).toEqual({ allowed: true });
  });
});

describe("checkTreeDrop blocked moves", () => {
  it("folder onto itself", () => {
    const result = checkTreeDrop(folder("DSA"), "DSA");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/itself/i);
  });

  it("folder into its direct child", () => {
    const result = checkTreeDrop(folder("DSA"), "DSA/Dynamic Programming");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/subfolder/i);
  });

  it("folder into a deep descendant", () => {
    const result = checkTreeDrop(
      folder("DSA"),
      "DSA/Dynamic Programming/Deep/Deeper",
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/subfolder/i);
  });

  it("into its current parent is a no-op", () => {
    const nested = checkTreeDrop(drawing("DSA/Graphs.excalidraw"), "DSA");
    expect(nested.allowed).toBe(false);
    expect(nested.reason).toMatch(/already in this folder/i);

    const rootDrawing = checkTreeDrop(drawing("Notes.excalidraw"), "");
    expect(rootDrawing.allowed).toBe(false);
    expect(rootDrawing.reason).toMatch(/already in this folder/i);

    const rootFolder = checkTreeDrop(folder("DSA"), "");
    expect(rootFolder.allowed).toBe(false);
  });

  it("read-only vault blocks everything, before other rules", () => {
    const result = checkTreeDrop(
      drawing("DSA/Graphs.excalidraw"),
      "DSA/Dynamic Programming",
      { readOnly: true },
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/read-only/i);
  });

  it("name clash in a folder names the folder", () => {
    const result = checkTreeDrop(
      drawing("DSA/Graphs.excalidraw"),
      "Archive/Old",
      { existingNames: ["Other.excalidraw", "Graphs.excalidraw"] },
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Graphs");
    expect(result.reason).not.toContain(".excalidraw");
    expect(result.reason).toContain('"Old"');
  });

  it("name clash at the vault root mentions the vault root", () => {
    const result = checkTreeDrop(folder("DSA/Dynamic Programming"), "", {
      existingNames: new Set(["Dynamic Programming"]),
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Dynamic Programming");
    expect(result.reason).toContain("the vault root");
  });

  it("structural rules win over a clash (no-op parent reports no-op)", () => {
    const result = checkTreeDrop(drawing("DSA/Graphs.excalidraw"), "DSA", {
      existingNames: ["Graphs.excalidraw"],
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/already in this folder/i);
  });
});

describe("checkTreeDrop name clashes use the backend's fold", () => {
  it("refuses a drop onto a name that differs only in capitals or accents, and says why", () => {
    const source = { path: "Été.excalidraw", name: "Été.excalidraw", kind: "drawing" as const };
    const r = checkTreeDrop(source, "A", { existingNames: ["été.excalidraw"] });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("été");
    expect(r.reason).toContain("capitals or accents");
    // A decomposed accent (e + combining acute) is the same name too.
    const d = checkTreeDrop(source, "A", { existingNames: ["Été.excalidraw"] });
    expect(d.allowed).toBe(false);
    expect(checkTreeDrop(source, "A", { existingNames: ["other.excalidraw"] }).allowed).toBe(true);
  });
});
