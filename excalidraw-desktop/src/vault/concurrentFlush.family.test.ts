import { describe, expect, it } from "vitest";

import { FakeNoteFiles } from "../notes/FakeNoteFiles";
import { NoteSaver } from "../notes/noteSaver";

import { SaveCoordinator } from "./saveCoordinator";

import type { VaultRepository } from "./types";

/**
 * Family sweep (bug hunt BH-10): every single-writer save queue that writes against a revision.
 * Several explicit saves (leaving edit mode, Cmd+S, blur, closing the window) can arrive while a
 * write is on its way; the user's own saves must never conflict with each other, and the last
 * text must reach the disk. Add a row per new revision-checked writer.
 */
type Writer = {
  edit: (text: string) => void;
  flush: () => Promise<void>;
  status: () => string;
  disk: () => string | undefined;
  release: () => void;
};

/** A disk that refuses a stale revision and holds every write until released. */
const gatedDisk = () => {
  let text = "one";
  let rev = 1;
  const gates: (() => void)[] = [];
  return {
    text: () => text,
    rev: () => `r${rev}`,
    async write(content: string, expected: string): Promise<string> {
      await new Promise<void>((res) => gates.push(res));
      if (expected !== `r${rev}`) {
        throw Object.assign(new Error("changed on disk"), { code: "CONFLICT" });
      }
      text = content;
      rev++;
      return `r${rev}`;
    },
    release: () => gates.splice(0).forEach((g) => g()),
  };
};

const writers: [string, () => Writer][] = [
  [
    "note saver",
    () => {
      const files = new FakeNoteFiles();
      files.setOnDisk("n.md", "one");
      const gates: (() => void)[] = [];
      let status = "saved";
      let saver!: NoteSaver;
      void files.read("h", "n.md").then((f) => {
        saver = new NoteSaver(
          {
            write: async (c, r) => {
              await new Promise<void>((res) => gates.push(res));
              return files.write("h", "n.md", c, r);
            },
            delayMs: () => 0,
            onStatus: (s) => (status = s),
          },
          { text: f.content, revision: f.revision },
        );
      });
      return {
        edit: (t) => saver.change(t),
        flush: () => saver.flush(),
        status: () => status,
        disk: () => files.textOf("n.md"),
        release: () => gates.splice(0).forEach((g) => g()),
      };
    },
  ],
  [
    "drawing save coordinator",
    () => {
      const disk = gatedDisk();
      let latest = "one";
      let revision = disk.rev();
      let status = "saved";
      const repository = {
        writeDrawing: async ({ json, expectedRevision }) => ({
          revision: await disk.write(json, expectedRevision ?? ""),
        }),
      } as Pick<VaultRepository, "writeDrawing"> as VaultRepository;
      const c = new SaveCoordinator({
        repository,
        target: () => ({
          handle: "h",
          path: "a.excalidraw",
          documentId: "d",
          revision,
        }),
        snapshot: () => latest,
        onStatus: (s) => (status = s),
        onSaved: (r) => (revision = r),
        idleMs: 1,
        maxWaitMs: 1,
      });
      return {
        edit: (t) => {
          latest = t;
          c.schedule();
        },
        flush: () => c.flush(),
        status: () => status,
        disk: disk.text,
        release: disk.release,
      };
    },
  ],
];

const settle = async (w: Writer, all: Promise<unknown>) => {
  let done = false;
  void all.finally(() => (done = true));
  for (let i = 0; i < 200 && !done; i++) {
    await new Promise((r) => setTimeout(r, 0));
    w.release();
  }
  await all;
};

describe.each(writers)("%s: saves arriving during a write", (_name, make) => {
  it.each([2, 3, 5])(
    "%i saves while a write runs end saved, last text on disk",
    async (n) => {
      const w = make();
      await Promise.resolve();
      w.edit("two");
      const saves = [w.flush()];
      w.edit("three");
      for (let i = 1; i < n; i++) {
        saves.push(w.flush());
      }
      await settle(w, Promise.all(saves));
      expect(w.status()).toBe("saved");
      expect(w.disk()).toBe("three");
    },
  );

  it("typing between each save still ends with the last text", async () => {
    const w = make();
    await Promise.resolve();
    const saves: Promise<void>[] = [];
    for (const t of ["a", "ab", "abc", "abcd"]) {
      w.edit(t);
      saves.push(w.flush());
    }
    await settle(w, Promise.all(saves));
    expect(w.status()).toBe("saved");
    expect(w.disk()).toBe("abcd");
  });
});
