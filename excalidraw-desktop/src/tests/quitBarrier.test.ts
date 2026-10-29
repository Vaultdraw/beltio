import { describe, expect, it } from "vitest";

import { runQuitBarrier, type QuitDeps } from "../quitBarrier";

type Decision = { current: "save" | "discard" | null };

const rig = (over: Partial<QuitDeps> = {}) => {
  const log = {
    notesPrompts: 0,
    discardPrompts: [] as string[][],
    destroyed: 0,
    notesFlushed: 0,
  };
  const deps: QuitDeps = {
    prepareLeave: () => {},
    flushDrawing: async () => {},
    notesAutosaveOff: () => true,
    unsavedNotePaths: () => ["Ideas.md"],
    describeNotes: (p) => `'${p.join(",")}'`,
    flushOpenNotes: async () => {
      log.notesFlushed++;
    },
    isNotesUnsavedError: () => null,
    flushLibrary: async () => {},
    flushPluginData: async () => {},
    destroyWindow: async () => {
      log.destroyed++;
    },
    askAboutNotes: () => {
      log.notesPrompts++;
    },
    askAboutDiscard: (what) => {
      log.discardPrompts.push(what);
    },
    closed: () => {},
    ...over,
  };
  return { deps, log };
};

describe("the quit barrier and the notes decision", () => {
  it("asks about dirty notes when autosave is off, and writes nothing yet", async () => {
    const { deps, log } = rig();
    const d: Decision = { current: null };
    await runQuitBarrier(deps, d);
    expect(log).toMatchObject({
      notesPrompts: 1,
      destroyed: 0,
      notesFlushed: 0,
    });
  });

  it("Don't Save closes without writing the notes", async () => {
    const { deps, log } = rig();
    const d: Decision = { current: "discard" };
    await runQuitBarrier(deps, d);
    expect(log).toMatchObject({
      notesPrompts: 0,
      destroyed: 1,
      notesFlushed: 0,
    });
    expect(d.current).toBeNull();
  });

  it("Don't Save is forgotten when another save fails and the window stays open: the next quit asks again", async () => {
    let drawingFails = true;
    const { deps, log } = rig({
      flushDrawing: async () => {
        if (drawingFails) {
          throw new Error("disk full");
        }
      },
    });
    const d: Decision = { current: "discard" };
    await runQuitBarrier(deps, d);
    expect(log.discardPrompts).toEqual([["the open drawing"]]);
    expect(log.destroyed).toBe(0);
    expect(d.current).toBeNull();
    // "Keep Window Open", the user types in the note again, the disk recovers, and quits.
    drawingFails = false;
    await runQuitBarrier(deps, d);
    expect(log.notesPrompts).toBe(1);
    expect(log.destroyed).toBe(0);
    expect(log.notesFlushed).toBe(0);
  });

  it("a flush that throws outright still lists what failed and forgets the decision", async () => {
    const { deps, log } = rig({
      destroyWindow: async () => {
        throw new Error("no window");
      },
    });
    const d: Decision = { current: "save" };
    await runQuitBarrier(deps, d);
    expect(log.discardPrompts).toHaveLength(1);
    expect(d.current).toBeNull();
  });

  it("names each note that could not be saved", async () => {
    const { deps, log } = rig({
      notesAutosaveOff: () => false,
      flushOpenNotes: async () => {
        throw new Error("x");
      },
      isNotesUnsavedError: (e) =>
        (e as Error).message === "x" ? ["A.md", "B.md"] : null,
    });
    await runQuitBarrier(deps, { current: "save" });
    expect(log.discardPrompts).toEqual([["'A.md'", "'B.md'"]]);
  });
});
