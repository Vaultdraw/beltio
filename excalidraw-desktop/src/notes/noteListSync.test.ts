import { describe, expect, it } from "vitest";

import { applyNoteOp, applyNoteOps, notesOpsFor } from "./noteListSync";

import type { NoteListOp } from "./noteListSync";

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
  it("ignores drawings", async () => {
    const r = repo({});
    expect(
      await notesOpsFor(r as any, "h", {
        paths: ["d.excalidraw"],
        rescan: false,
      }),
    ).toEqual([]);
  });
  it("re-walks a folder renamed outside the app, with no rescan flag", async () => {
    const r = repo({ "B/x.md": "note" });
    expect(
      await notesOpsFor(r as any, "h", { paths: ["A", "B"], rescan: false }),
    ).toEqual([
      { kind: "folder", path: "A", notes: [] },
      { kind: "folder", path: "B", notes: ["B/x.md"] },
    ]);
  });
  it("lists each parent once for a burst, and skips notes under a re-walked folder", async () => {
    const files: Record<string, "note"> = {};
    const paths: string[] = [];
    for (let i = 0; i < 50; i++) {
      files[`Big/n${i}.md`] = "note";
      paths.push(`Big/n${i}.md`);
    }
    files["Moved/m.md"] = "note";
    paths.push("Moved", "Moved/m.md");
    const base = repo(files);
    const calls: string[] = [];
    const r = {
      ...base,
      listDirectory: (h: string, d: string) => {
        calls.push(d);
        return base.listDirectory(h, d);
      },
    };
    const ops = await notesOpsFor(r as any, "h", { paths, rescan: false });
    expect(calls.filter((d) => d === "Big")).toHaveLength(1);
    expect(ops.filter((o) => o.kind === "note")).toHaveLength(50);
    expect(ops.filter((o) => o.kind === "folder")).toEqual([
      { kind: "folder", path: "Moved", notes: ["Moved/m.md"] },
    ]);
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

describe("applyNoteOps", () => {
  it("matches applying the ops one by one, and keeps the array when nothing changes", () => {
    const list = ["a.md", "F/b.md", "G/c.md"];
    const ops: NoteListOp[] = [
      { kind: "note", path: "z.md", exists: true },
      { kind: "note", path: "a.md", exists: false },
      { kind: "folder", path: "F", notes: ["F/new.md"] },
    ];
    expect(applyNoteOps(list, ops).sort()).toEqual(
      ops.reduce(applyNoteOp, list).sort(),
    );
    expect(
      applyNoteOps(list, [
        { kind: "note", path: "a.md", exists: true },
        { kind: "note", path: "nope.md", exists: false },
      ]),
    ).toBe(list);
    expect(applyNoteOps(list, [])).toBe(list);
  });
});
