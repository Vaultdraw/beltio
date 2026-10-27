import { describe, expect, it, vi } from "vitest";

import { FakeNoteFiles } from "./FakeNoteFiles";
import { DesktopNoteFiles, NoteConflictError } from "./noteFiles";

describe("FakeNoteFiles (the contract the editor codes against)", () => {
  it("creates, reads, edits with the revision and keeps a history copy", async () => {
    const f = new FakeNoteFiles();
    const w1 = await f.write("h", "a.md", "# One\n", null);
    expect(w1.historyCopy).toBeNull();
    const r = await f.read("h", "a.md");
    expect(r.content).toBe("# One\n");
    expect(r.revision).toBe(w1.revision);
    const w2 = await f.write("h", "a.md", "# Two\n", r.revision);
    expect(w2.historyCopy).toContain("note-history");
    expect(f.copiesOf("a.md")).toEqual(["# One\n"]);
  });

  it("refuses a stale revision, a create over an existing note, and changes nothing", async () => {
    const f = new FakeNoteFiles();
    const w = await f.write("h", "n.md", "v1", null);
    f.setOnDisk("n.md", "edited elsewhere");
    await expect(f.write("h", "n.md", "v2", w.revision)).rejects.toBeInstanceOf(
      NoteConflictError,
    );
    await expect(f.write("h", "n.md", "x", null)).rejects.toBeInstanceOf(
      NoteConflictError,
    );
    expect(f.textOf("n.md")).toBe("edited elsewhere");
    expect(f.copiesOf("n.md")).toEqual([]);
  });

  it("treats unchanged text as a no-op and keeps only the last 20 copies", async () => {
    const f = new FakeNoteFiles();
    let rev = (await f.write("h", "h.md", "0", null)).revision;
    const same = await f.write("h", "h.md", "0", rev);
    expect(same.historyCopy).toBeNull();
    for (let i = 1; i <= 25; i++) {
      rev = (await f.write("h", "h.md", String(i), rev)).revision;
    }
    expect(f.copiesOf("h.md")).toHaveLength(20);
  });

  it("applies the native path rules", async () => {
    const f = new FakeNoteFiles();
    for (const p of [
      ".obsidian/x.md",
      "a/.hidden/x.md",
      "x.txt",
      "x.excalidraw.md",
      "../x.md",
      "/x.md",
      ".md",
    ]) {
      await expect(f.write("h", p, "x", null)).rejects.toMatchObject({
        code: "INVALID_PATH",
      });
    }
    f.readOnly = true;
    await expect(f.write("h", "ok.md", "x", null)).rejects.toMatchObject({
      code: "READ_ONLY",
    });
  });
});

describe("DesktopNoteFiles", () => {
  it("calls the native commands and maps CONFLICT to NoteConflictError", async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === "write_note") {
        throw Object.assign(new Error("changed"), { code: "CONFLICT" });
      }
      return { content: "x", revision: "r", mtimeMs: 1, size: 1 };
    });
    const d = new DesktopNoteFiles(invoke as never);
    expect((await d.read("h", "a.md")).revision).toBe("r");
    expect(invoke).toHaveBeenCalledWith("read_note", {
      handle: "h",
      path: "a.md",
    });
    await expect(d.write("h", "a.md", "t", "r")).rejects.toBeInstanceOf(
      NoteConflictError,
    );
    expect(invoke).toHaveBeenLastCalledWith("write_note", {
      handle: "h",
      path: "a.md",
      content: "t",
      expectedRevision: "r",
    });
  });
});
