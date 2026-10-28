import { describe, expect, it } from "vitest";

import {
  describeNotes,
  flushOpenNotes,
  NotesUnsavedError,
  registerOpenNote,
  unsavedNotePaths,
} from "./openNotes";

import type { SaveStatus } from "./noteSaver";

const note = (path: string, init: SaveStatus, after: SaveStatus = "saved") => {
  let st = init;
  const flush = async () => {
    st = after;
  };
  return { path, state: () => st, flush };
};

describe("openNotes", () => {
  it("lists unsaved notes and flushes them", async () => {
    const a = registerOpenNote(note("a.md", "dirty"));
    const b = registerOpenNote(note("b.md", "saved"));
    expect(unsavedNotePaths()).toEqual(["a.md"]);
    await flushOpenNotes();
    expect(unsavedNotePaths()).toEqual([]);
    a();
    b();
  });

  it("rejects when a note is still unsaved after the flush", async () => {
    const off = registerOpenNote(note("c.md", "dirty", "conflict"));
    await expect(flushOpenNotes()).rejects.toThrow("c.md");
    off();
    expect(unsavedNotePaths()).toEqual([]);
  });
});

describe("openNotes: naming and independent flushes", () => {
  it("names notes for a dialog", () => {
    expect(describeNotes(["a.md"])).toBe("'a.md'");
    expect(describeNotes(["x/a.md", "b.md"])).toBe("'a.md' and 'b.md'");
    expect(describeNotes(["a", "b", "c", "d", "e"])).toBe(
      "'a', 'b', 'c' and 2 more",
    );
  });

  it("a failing note does not stop the others, and the error names only the failed one", async () => {
    const good = note("good.md", "dirty");
    const bad = note("bad.md", "dirty", "conflict");
    const off = [registerOpenNote(bad), registerOpenNote(good)];
    const err = await flushOpenNotes().catch((e) => e);
    expect(err).toBeInstanceOf(NotesUnsavedError);
    expect((err as NotesUnsavedError).paths).toEqual(["bad.md"]);
    expect(good.state()).toBe("saved");
    off.forEach((f) => f());
  });
});
