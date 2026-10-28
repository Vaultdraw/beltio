import { describe, expect, it } from "vitest";

import {
  flushOpenNotes,
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
