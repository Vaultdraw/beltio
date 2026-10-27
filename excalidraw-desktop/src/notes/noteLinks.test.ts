import { describe, expect, it } from "vitest";

import { createNoteLinkIndex } from "./noteLinks";

const idx = createNoteLinkIndex([
  "Home.md",
  "Projects/Plan.md",
  "Archive/Plan.md",
  "Projects/Sketch.excalidraw",
  "Notes/Sketch.md",
  "Pics/a.png",
  "Daily/2026-10-27.md",
]);

describe("note link resolution", () => {
  it("finds a name with or without .md, ignoring case", () => {
    expect(idx.resolve("x.md", "home")).toBe("Home.md");
    expect(idx.resolve("x.md", "Home.md")).toBe("Home.md");
  });

  it("prefers the file closest to the linking note", () => {
    expect(idx.resolve("Projects/a.md", "Plan")).toBe("Projects/Plan.md");
    expect(idx.resolve("Archive/b.md", "Plan")).toBe("Archive/Plan.md");
  });

  it("matches paths and path tails", () => {
    expect(idx.resolve("x.md", "Projects/Plan")).toBe("Projects/Plan.md");
    expect(idx.resolve("x.md", "Daily/2026-10-27")).toBe("Daily/2026-10-27.md");
    expect(idx.resolve("x.md", "ects/Plan")).toBeNull();
  });

  it("a note beats a drawing of the same name; a drawing is found alone", () => {
    expect(idx.resolve("x.md", "Sketch")).toBe("Notes/Sketch.md");
    expect(idx.resolve("x.md", "Sketch.excalidraw")).toBe(
      "Projects/Sketch.excalidraw",
    );
  });

  it("other files need their extension", () => {
    expect(idx.resolve("x.md", "a.png")).toBe("Pics/a.png");
    expect(idx.resolve("x.md", "a")).toBeNull();
  });

  it("resolves explicit relative links", () => {
    expect(idx.resolve("Projects/a.md", "./Plan")).toBe("Projects/Plan.md");
    expect(idx.resolve("Projects/a.md", "../Home")).toBe("Home.md");
  });

  it("returns null for the empty or unknown", () => {
    expect(idx.resolve("x.md", " ")).toBeNull();
    expect(idx.resolve("x.md", "Missing")).toBeNull();
  });
});
