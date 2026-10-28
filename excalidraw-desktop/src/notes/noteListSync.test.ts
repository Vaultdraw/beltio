import { describe, expect, it } from "vitest";

import { applyNoteOp, notesOpsFor } from "./noteListSync";

const repo = (files: Record<string, "note" | "other" | string[]>) => ({
  readRevision: async (_h: string, p: string) => (p in files ? "r" : null),
  listDirectory: async (_h: string, dir: string) => {
    const out: { path: string; kind: string }[] = [];
    for (const p of Object.keys(files)) {
      const parent = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
      if (parent === dir) {
        out.push({
          path: p,
          kind: Array.isArray(files[p]) ? "folder" : "note",
        });
      }
    }
    if (
      dir !== "" &&
      !Object.keys(files).some((p) => p.startsWith(`${dir}/`))
    ) {
      throw new Error("gone");
    }
    return out as any;
  },
});

describe("applyNoteOp", () => {
  it("adds, removes and ignores no-ops", () => {
    const list = ["a.md"];
    expect(
      applyNoteOp(list, { kind: "note", path: "b.md", exists: true }),
    ).toEqual(["a.md", "b.md"]);
    expect(
      applyNoteOp(list, { kind: "note", path: "a.md", exists: true }),
    ).toBe(list);
    expect(
      applyNoteOp(list, { kind: "note", path: "a.md", exists: false }),
    ).toEqual([]);
    expect(
      applyNoteOp(list, { kind: "note", path: "z.md", exists: false }),
    ).toBe(list);
  });
  it("replaces a folder subtree", () => {
    expect(
      applyNoteOp(["F/a.md", "G/b.md"], {
        kind: "folder",
        path: "F",
        notes: ["F/c.md"],
      }),
    ).toEqual(["G/b.md", "F/c.md"]);
  });
});

describe("notesOpsFor", () => {
  it("probes a created note and a deleted note", async () => {
    const r = repo({ "new.md": "note" });
    const ops = await notesOpsFor(r as any, "h", {
      paths: ["new.md", "old.md"],
      rescan: false,
    });
    expect(ops).toEqual([
      { kind: "note", path: "new.md", exists: true },
      { kind: "note", path: "old.md", exists: false },
    ]);
  });
  it("ignores drawings and, without rescan, folders", async () => {
    const r = repo({});
    expect(
      await notesOpsFor(r as any, "h", {
        paths: ["d.excalidraw", "Folder"],
        rescan: false,
      }),
    ).toEqual([]);
    expect(
      await notesOpsFor(r as any, "h", {
        paths: ["d.excalidraw"],
        rescan: true,
      }),
    ).toEqual([]);
  });
  it("re-walks a moved folder on a rescan event", async () => {
    const r = repo({ "New/x.md": "note" });
    const ops = await notesOpsFor(r as any, "h", {
      paths: ["Old", "New"],
      rescan: true,
    });
    expect(ops).toEqual([
      { kind: "folder", path: "Old", notes: [] },
      { kind: "folder", path: "New", notes: ["New/x.md"] },
    ]);
  });
});
