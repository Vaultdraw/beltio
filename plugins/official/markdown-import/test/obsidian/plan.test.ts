import { describe, expect, test } from "vitest";

import { LinkResolver, drawingLink } from "../../src/obsidian/links";
import { partPath, planImport } from "../../src/obsidian/plan";

const e = (path: string) => ({ path, size: 1, modifiedAt: 1 });
const on = { obsidianAttachments: true, obsidianExcalidraw: true };

describe("planImport", () => {
  test("kinds, targets, dot entries and the settings", () => {
    const entries = [
      "a/Note.md",
      "a/S.excalidraw.md",
      "a/D.excalidraw",
      "a/p.png",
      ".obsidian/x.json",
      "b/.hidden/x.md",
    ].map(e);
    const p = planImport(entries, on);
    expect(p.items.map((i) => [i.kind, i.target])).toEqual([
      ["note", "a/Note.excalidraw"],
      ["drawing", "a/D.excalidraw"],
      ["excalidrawMd", "a/S.excalidraw"],
      ["attachment", "a/p.png"],
    ]);
    expect(p.skipped).toBe(2);
    const off = planImport(entries, {
      obsidianAttachments: false,
      obsidianExcalidraw: false,
    });
    expect(off.items.map((i) => i.path)).toEqual([
      "a/Note.md",
      "a/D.excalidraw",
    ]);
  });

  test("names that collide case-insensitively are renamed, never merged", () => {
    const p = planImport(
      ["x/Idea.md", "x/idea.markdown", "x/Idea.excalidraw"].map(e),
      on,
    );
    const targets = p.items.map((i) => i.target.toLowerCase());
    expect(new Set(targets).size).toBe(3);
    expect(
      p.items.some(
        (i) =>
          i.target === "x/Idea 2.excalidraw" ||
          i.target === "x/idea 2.excalidraw",
      ),
    ).toBe(true);
  });

  test("part names", () => {
    expect(partPath("a/N.excalidraw", 1)).toBe("a/N.excalidraw");
    expect(partPath("a/N.excalidraw", 3)).toBe("a/N (part 3).excalidraw");
  });
});

describe("LinkResolver", () => {
  const plan = planImport(
    [
      "Home.md",
      "Projects/Alpha/Plan.md",
      "Archive/Plan.md",
      "Drawings/S.excalidraw.md",
      "img/p.png",
    ].map(e),
    on,
  );
  const r = new LinkResolver(plan.items);
  test("Obsidian's rules: exact path, then the shortest path with that name, case-insensitive", () => {
    expect(r.resolve("home")?.target).toBe("Home.excalidraw");
    expect(r.resolve("Projects/Alpha/Plan")?.target).toBe(
      "Projects/Alpha/Plan.excalidraw",
    );
    expect(r.resolve("Alpha/Plan")?.target).toBe(
      "Projects/Alpha/Plan.excalidraw",
    );
    expect(r.resolve("Plan")?.target).toBe("Archive/Plan.excalidraw");
    expect(r.resolve("S")?.target).toBe("Drawings/S.excalidraw");
    expect(r.resolve("S.excalidraw")?.target).toBe("Drawings/S.excalidraw");
    expect(r.resolve("p.png", ["attachment"])?.path).toBe("img/p.png");
    expect(r.resolve("p.png", ["note"])).toBeNull();
    expect(r.resolve("Nope")).toBeNull();
  });
  test("drawingLink follows Vaultdraw's grammar", () => {
    expect(drawingLink("a/B")).toBe("[[a/B]]");
    expect(drawingLink("a/B", "label")).toBe("[[a/B|label]]");
    expect(drawingLink("a/B", "a/B")).toBe("[[a/B]]");
    expect(drawingLink("a/B", "bad]label")).toBeNull();
    expect(drawingLink("x".repeat(300))).toBeNull();
  });
});
